import { createServiceClient } from "@/lib/supabase/server";
import {
  formatAnnonceMessage,
  formatDigestMessage,
  sendWhatsAppMessage,
  isWahaConfigured,
} from "@/lib/whatsapp";
import {
  DEFAULT_MAX_ALERTS_PER_DAY,
  DEFAULT_QUIET_END,
  DEFAULT_QUIET_START,
  isQuietHour,
  matchDemand,
  shouldSend,
  startOfLocalDayIso,
} from "@/lib/matching";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sleep } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import type { Annonce, ClientDemand } from "@/types/database";

// Appelée en POST par le service cron Railway ; GET accepté aussi pour un déclenchement manuel.
export const dynamic = "force-dynamic";
export const GET = handleCron;
export const POST = handleCron;

const RECENT_ANNONCES = 100;
const DIGEST_MAX_ITEMS = 5;

function versionOf(annonce: Annonce): number {
  const details = (annonce as unknown as { details?: { version?: unknown } }).details;
  return typeof details?.version === "number" ? details.version : 1;
}

async function handleCron(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (!isWahaConfigured()) {
    return NextResponse.json({ error: "WAHA non configuré" }, { status: 503 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const dayStart = startOfLocalDayIso(now);

  const { data: demands } = await supabase.from("client_demands").select("*").eq("is_active", true);

  if (!demands?.length) {
    return NextResponse.json({ message: "No active demands" });
  }

  const byUser = new Map<string, ClientDemand[]>();
  for (const d of demands) {
    const demand = d as unknown as ClientDemand;
    byUser.set(demand.user_id, [...(byUser.get(demand.user_id) || []), demand]);
  }

  const stats = { totalSent: 0, digests: 0, heldForReview: 0, skippedQuiet: 0, capped: 0, failed: 0 };

  for (const [userId, userDemands] of Array.from(byUser.entries())) {
    // Préfiltrage SQL : annonces immobilières récentes du compte. Les critères de
    // l'abonné sont ensuite appliqués par matchDemand (bloquants, puis score).
    const { data: rows } = await supabase
      .from("annonces")
      .select("*")
      .eq("user_id", userId)
      .eq("ai_is_real_estate", true)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(RECENT_ANNONCES);

    const annonces = (rows || []) as unknown as Annonce[];
    if (!annonces.length) continue;

    for (const demand of userDemands) {
      if (isQuietHour(now, demand.quiet_start ?? DEFAULT_QUIET_START, demand.quiet_end ?? DEFAULT_QUIET_END)) {
        stats.skippedQuiet++;
        continue;
      }

      const { data: sends } = await supabase
        .from("client_demand_sends")
        .select("*")
        .eq("demand_id", demand.id);

      // Clé d'unicité abonné + annonce : une annonce déjà tentée n'est jamais renvoyée.
      // Clé d'unicité abonné + annonce + version : une annonce dont le prix a changé (nouvelle
      // version) peut être renvoyée une fois, jamais deux fois la même version.
      const alreadySent = new Set((sends || []).map((s) => `${s.annonce_id}:${s.annonce_version ?? 1}`));
      const sentToday = (sends || []).filter(
        (s) => s.status !== "failed" && typeof s.sent_at === "string" && s.sent_at >= dayStart
      ).length;

      const candidates: { annonce: Annonce; score: number }[] = [];
      for (const annonce of annonces) {
        if (alreadySent.has(`${annonce.id}:${versionOf(annonce)}`)) continue;
        const match = matchDemand(annonce, demand);
        if (!match.eligible) continue;
        if (match.needsReview) {
          stats.heldForReview++;
          continue;
        }
        if (shouldSend(match, demand)) candidates.push({ annonce, score: match.score });
      }
      if (!candidates.length) continue;
      candidates.sort((a, b) => b.score - a.score);

      const record = async (annonce: Annonce, messageId: string | undefined, success: boolean) => {
        const row = {
          demand_id: demand.id,
          annonce_id: annonce.id,
          message_id: messageId || null,
          status: success ? "sent" : "failed",
        };
        const version = versionOf(annonce);
        if (version === 1) return supabase.from("client_demand_sends").insert(row);
        const { error } = await supabase.from("client_demand_sends").insert({ ...row, annonce_version: version });
        // Base sans la colonne annonce_version : on enregistre quand même l'envoi.
        if (error) await supabase.from("client_demand_sends").insert(row);
      };

      if (demand.alert_mode === "digest") {
        // Résumé périodique : un seul message par jour, regroupant les meilleures annonces.
        if (sentToday > 0) continue;
        const picked = candidates.slice(0, DIGEST_MAX_ITEMS).map((c) => c.annonce);
        const result = await sendWhatsAppMessage(demand.client_phone, formatDigestMessage(picked));
        for (const annonce of picked) await record(annonce, result.messageId, result.success);
        if (result.success) {
          stats.digests++;
          stats.totalSent += picked.length;
        } else {
          stats.failed++;
        }
        await sleep(500);
        continue;
      }

      const remaining = Math.max(0, (demand.max_alerts_per_day ?? DEFAULT_MAX_ALERTS_PER_DAY) - sentToday);
      if (candidates.length > remaining) stats.capped += candidates.length - remaining;

      for (const { annonce } of candidates.slice(0, remaining)) {
        const result = await sendWhatsAppMessage(demand.client_phone, formatAnnonceMessage(annonce));
        await record(annonce, result.messageId, result.success);
        if (result.success) stats.totalSent++;
        else stats.failed++;
        await sleep(500); // Avoid WhatsApp rate limits
      }
    }
  }

  return NextResponse.json({ success: true, ...stats });
}
