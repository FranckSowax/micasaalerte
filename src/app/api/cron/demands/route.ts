import { createServiceClient } from "@/lib/supabase/server";
import { clientLink, generateAccessToken } from "@/lib/client-access";
import { formatAccessEndedMessage, formatClientLinkMessage, sendWhatsAppMessage, isWahaConfigured } from "@/lib/whatsapp";
import { needsExpiryNotice, subscriptionState, SUBSCRIPTION_DAYS, SUBSCRIPTION_PRICE_FCFA } from "@/lib/subscription";
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

// Alertes aux abonnés, à lancer toutes les heures.
// Pour chaque abonné dont l'accès est en cours (essai de 24 h ou période payée) : on cherche
// les annonces récentes qui correspondent à ses critères et qu'il n'a pas encore reçues, on
// les ajoute à son espace personnel, puis on lui envoie UN message WhatsApp contenant son
// lien. Pas de message s'il n'y a rien de nouveau. Un abonné dont l'accès est terminé ne
// reçoit plus d'annonces : il est prévenu une fois, avec le lien pour renouveler.
// Appelée en POST par un service cron ; GET accepté aussi pour un déclenchement manuel.
export const dynamic = "force-dynamic";
export const GET = handleCron;
export const POST = handleCron;

const RECENT_ANNONCES = 200;
/** Annonces ajoutées à l'espace d'un abonné par passage, les mieux notées d'abord. */
const MAX_PER_RUN = 10;

type Supabase = ReturnType<typeof createServiceClient>;

function versionOf(annonce: Annonce): number {
  const details = (annonce as unknown as { details?: { version?: unknown } }).details;
  return typeof details?.version === "number" ? details.version : 1;
}

/** Lien personnel : créé au premier besoin, puis réutilisé. Null si la migration SQL manque. */
async function ensureToken(supabase: Supabase, demand: ClientDemand): Promise<string | null> {
  if (demand.access_token) return demand.access_token;
  const token = generateAccessToken();
  const { error } = await supabase.from("client_demands").update({ access_token: token }).eq("id", demand.id);
  return error ? null : token;
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
  // Test manuel : `?quiet=off` ignore la plage silencieuse pour ce passage (toujours avec le secret du cron).
  const ignoreQuiet = new URL(request.url).searchParams.get("quiet") === "off";

  const { data: demands } = await supabase.from("client_demands").select("*").eq("is_active", true);

  if (!demands?.length) {
    return NextResponse.json({ message: "No active demands" });
  }

  const byUser = new Map<string, ClientDemand[]>();
  for (const d of demands) {
    const demand = d as unknown as ClientDemand;
    byUser.set(demand.user_id, [...(byUser.get(demand.user_id) || []), demand]);
  }

  const stats = {
    clients: demands.length,
    messagesSent: 0,
    annoncesAdded: 0,
    heldForReview: 0,
    skippedQuiet: 0,
    capped: 0,
    expired: 0,
    expiryNotices: 0,
    failed: 0,
    migrationNeeded: false,
  };

  for (const [userId, userDemands] of Array.from(byUser.entries())) {
    // Préfiltrage SQL : annonces immobilières récentes et non archivées du compte. Les critères
    // de l'abonné sont ensuite appliqués par matchDemand (bloquants, distance, score).
    const { data: rows } = await supabase
      .from("annonces")
      .select("*")
      .eq("user_id", userId)
      .eq("ai_is_real_estate", true)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(RECENT_ANNONCES);

    const annonces = (rows || []) as unknown as Annonce[];

    for (const demand of userDemands) {
      if (!ignoreQuiet && isQuietHour(now, demand.quiet_start ?? DEFAULT_QUIET_START, demand.quiet_end ?? DEFAULT_QUIET_END)) {
        stats.skippedQuiet++;
        continue;
      }

      // Accès terminé (essai ou abonnement) : plus d'annonces, un seul message pour renouveler.
      if (subscriptionState(demand, now).status === "expired") {
        stats.expired++;
        if (!needsExpiryNotice(demand, now)) continue;
        const token = await ensureToken(supabase, demand);
        if (!token) {
          stats.migrationNeeded = true;
          continue;
        }
        const notice = await sendWhatsAppMessage(
          demand.client_phone,
          formatAccessEndedMessage({
            name: demand.client_name,
            trial: !demand.paid_until,
            link: clientLink(token),
            price: SUBSCRIPTION_PRICE_FCFA,
            days: SUBSCRIPTION_DAYS,
          })
        );
        if (notice.success) {
          await supabase.from("client_demands").update({ expiry_notified_at: now.toISOString() }).eq("id", demand.id);
          stats.expiryNotices++;
          await sleep(1000);
        } else {
          stats.failed++;
        }
        continue;
      }

      if (!annonces.length) continue;

      const { data: sends } = await supabase.from("client_demand_sends").select("*").eq("demand_id", demand.id);

      // Clé d'unicité abonné + annonce + version : une annonce dont le prix a changé (nouvelle
      // version) peut être signalée une fois de plus, jamais deux fois la même version.
      const alreadySent = new Set((sends || []).map((s) => `${s.annonce_id}:${s.annonce_version ?? 1}`));
      const addedToday = (sends || []).filter(
        (s) => s.status !== "failed" && typeof s.sent_at === "string" && s.sent_at >= dayStart
      ).length;

      // Résumé quotidien : un seul message par jour.
      if (demand.alert_mode === "digest" && addedToday > 0) continue;

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

      const remaining = Math.max(0, (demand.max_alerts_per_day ?? DEFAULT_MAX_ALERTS_PER_DAY) - addedToday);
      const picked = candidates.slice(0, Math.min(remaining, MAX_PER_RUN)).map((c) => c.annonce);
      if (candidates.length > picked.length) stats.capped += candidates.length - picked.length;
      if (!picked.length) continue;

      const token = await ensureToken(supabase, demand);
      if (!token) {
        // Colonne access_token absente : la migration SQL n'a pas été exécutée.
        stats.migrationNeeded = true;
        continue;
      }

      // WHY: on envoie d'abord, on enregistre ensuite. Si l'envoi échoue, rien n'est marqué
      // comme reçu et les mêmes annonces seront proposées au passage suivant.
      const result = await sendWhatsAppMessage(
        demand.client_phone,
        formatClientLinkMessage({ name: demand.client_name, count: picked.length, link: clientLink(token) })
      );
      if (!result.success) {
        stats.failed++;
        continue;
      }

      for (const annonce of picked) {
        const row = { demand_id: demand.id, annonce_id: annonce.id, message_id: result.messageId || null, status: "sent" };
        const version = versionOf(annonce);
        if (version === 1) {
          await supabase.from("client_demand_sends").insert(row);
        } else {
          const { error } = await supabase.from("client_demand_sends").insert({ ...row, annonce_version: version });
          // Base sans la colonne annonce_version : on enregistre quand même.
          if (error) await supabase.from("client_demand_sends").insert(row);
        }
      }
      stats.messagesSent++;
      stats.annoncesAdded += picked.length;
      await sleep(1000); // Espace les messages : ménage le numéro WhatsApp
    }
  }

  return NextResponse.json({ success: true, ...stats });
}
