import { createServiceClient } from "@/lib/supabase/server";
import { clientLink, generateAccessToken } from "@/lib/client-access";
import { formatAccessEndedMessage, formatClientLinkMessage, sendWhatsAppMessage, isWahaConfigured } from "@/lib/whatsapp";
import { needsExpiryNotice, planOffer, subscriptionState, SUBSCRIPTION_PLANS } from "@/lib/subscription";
import {
  DEFAULT_MAX_ALERTS_PER_DAY,
  DEFAULT_QUIET_END,
  DEFAULT_QUIET_START,
  isQuietHour,
  matchDemand,
  shouldSend,
  shouldSendForCheck,
  startOfLocalDayIso,
} from "@/lib/matching";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { isCopyablePhoto, isStoredPhoto } from "@/lib/photos";
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
  const resendLink = new URL(request.url).searchParams.get("resend") === "on";

  const { data: demands } = await supabase.from("client_demands").select("*").eq("is_active", true);

  if (!demands?.length) {
    return NextResponse.json({ message: "No active demands" });
  }

  // Diagnostic : `?explain=on` n'envoie rien. Pour chaque client, il rend ses critères et, pour ses
  // dernières annonces reçues, le résultat du matching recalculé. Ni nom ni numéro dans la réponse.
  if (new URL(request.url).searchParams.get("explain") === "on") {
    const report = [];
    for (const d of demands) {
      const demand = d as unknown as ClientDemand;
      const { data: sends } = await supabase
        .from("client_demand_sends")
        .select("*")
        .eq("demand_id", demand.id)
        .order("sent_at", { ascending: false })
        .limit(15);
      const ids = (sends || []).map((s) => s.annonce_id as string);
      const { data: rows } = ids.length ? await supabase.from("annonces").select("*").in("id", ids) : { data: [] };
      const byId = new Map(((rows || []) as unknown as Annonce[]).map((a) => [a.id, a]));

      // Bilan sur les annonces récentes du compte : combien partiraient, combien sont retenues,
      // et quel critère en écarte le plus (« aUnCritere » = écartées par ce seul critère).
      const { data: recentRows } = await supabase
        .from("annonces")
        .select("*")
        .eq("user_id", demand.user_id)
        .eq("ai_is_real_estate", true)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(RECENT_ANNONCES);
      const recent = (recentRows || []) as unknown as Annonce[];
      const sentIds = new Set(ids);
      const bilan = { annonces: recent.length, depuis: recent[recent.length - 1]?.created_at ?? null, dejaRecues: 0, aEnvoyer: 0, aVerifier: 0, scoreInsuffisant: 0 };
      const ecartees: Record<string, number> = {};
      const aUnCritere: Record<string, number> = {};
      for (const annonce of recent) {
        if (sentIds.has(annonce.id)) {
          bilan.dejaRecues++;
          continue;
        }
        const m = matchDemand(annonce, demand);
        if (!m.eligible) {
          for (const reason of m.blockedBy) ecartees[reason] = (ecartees[reason] || 0) + 1;
          if (m.blockedBy.length === 1) aUnCritere[m.blockedBy[0]] = (aUnCritere[m.blockedBy[0]] || 0) + 1;
        } else if (m.needsReview) bilan.aVerifier++;
        else if (shouldSend(m, demand)) bilan.aEnvoyer++;
        else bilan.scoreInsuffisant++;
      }

      report.push({
        numero: `…${String(demand.client_phone).slice(-4)}`,
        acces: subscriptionState(demand, now).status,
        modeAlerte: demand.alert_mode ?? null,
        bilan,
        ecartees,
        aUnCritere,
        criteria: {
          offre: demand.filter_type_offre,
          bien: demand.filter_type_bien,
          prixMin: demand.filter_prix_min,
          prixMax: demand.filter_prix_max,
          chambresMin: demand.filter_nb_chambres_min,
          ville: demand.filter_ville,
          quartiers: (demand.filter_quartiers || []).length,
          secteur: typeof demand.geo_lat === "number" ? `${demand.geo_radius_km ?? "?"} km` : null,
          exigences: demand.exigences,
        },
        sent: await Promise.all((sends || []).map(async (s) => {
          const annonce = byId.get(s.annonce_id as string);
          if (!annonce) return { status: s.status, missing: true };
          const m = matchDemand(annonce, demand);
          // Photo : combien de liens, copie permanente ou lien du réseau d'origine, et répond-elle ?
          const images = Array.isArray(annonce.raw_images) ? annonce.raw_images : [];
          let photoHttp: number | string | null = null;
          // On n'interroge que notre stockage ou les serveurs d'images autorisés, jamais une adresse quelconque.
          if (images[0] && (isStoredPhoto(images[0]) || isCopyablePhoto(images[0]))) {
            try {
              photoHttp = (await fetch(images[0], { method: "HEAD", signal: AbortSignal.timeout(8000) })).status;
            } catch {
              photoHttp = "injoignable";
            }
          }
          return {
            photos: images.length,
            photoStored: images[0] ? isStoredPhoto(images[0]) : null,
            photoHost: images[0] ? new URL(images[0]).hostname.split(".").slice(-2).join(".") : null,
            photoHttp,
            source: String(annonce.fb_post_id || "").startsWith("tiktok_") ? "tiktok" : "facebook",
            status: s.status,
            via: s.message_id === "review_dismissed" ? "écartée" : s.message_id ? "message" : "sans message",
            sentAt: s.sent_at,
            offre: annonce.type_offre,
            bien: annonce.type_bien,
            prix: annonce.prix,
            ville: annonce.ville,
            quartier: annonce.quartier,
            chambres: annonce.nb_chambres,
            score: m.score,
            blockedBy: m.blockedBy,
            uncertain: m.uncertain,
            resume: (annonce.ai_summary || annonce.raw_text || "").slice(0, 140),
          };
        })),
      });
    }
    return NextResponse.json({ explain: report });
  }

  // Test manuel : `?resend=on` renvoie simplement son lien au client, sans nouvelle annonce.
  // WHY: réservé à une base à un seul client actif, pour ne jamais écrire à tous les abonnés.
  if (resendLink) {
    if (demands.length > 1) return NextResponse.json({ error: "resend refusé : plusieurs clients actifs" }, { status: 409 });
    const demand = demands[0] as unknown as ClientDemand;
    const token = await ensureToken(supabase, demand);
    if (!token) return NextResponse.json({ error: "Migration SQL requise" }, { status: 500 });
    const sent = await sendWhatsAppMessage(
      demand.client_phone,
      formatClientLinkMessage({ name: demand.client_name, link: clientLink(token), resend: true })
    );
    return NextResponse.json({ success: sent.success, linksResent: sent.success ? 1 : 0 }, { status: sent.success ? 200 : 502 });
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
    sentForCheck: 0,
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
            offers: SUBSCRIPTION_PLANS.map(planOffer),
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
          // Une seule information manquante : l'annonce part chez l'abonné, qui la trouve dans son
          // onglet « À vérifier ». Plus d'un manque, ou annonce presque vide : elle reste chez l'agent.
          if (shouldSendForCheck(match, demand)) {
            candidates.push({ annonce, score: match.score });
            stats.sentForCheck++;
          } else {
            stats.heldForReview++;
          }
          continue;
        }
        if (shouldSend(match, demand)) candidates.push({ annonce, score: match.score });
      }
      if (!candidates.length) continue;
      candidates.sort((a, b) => b.score - a.score);

      // Toutes les annonces en attente partent d'un coup : l'alerte est un seul message avec un lien,
      // il n'y a donc plus de rafale à éviter. Seul reste le plafond quotidien, filet de sécurité
      // contre des critères trop larges ou un emballement de la collecte.
      // WHY: Math.max — les abonnés existants ont encore l'ancien plafond (30) enregistré en base ;
      // le minimum du code s'applique tant que la base n'est pas mise à jour.
      const dailyCap = Math.max(demand.max_alerts_per_day ?? DEFAULT_MAX_ALERTS_PER_DAY, DEFAULT_MAX_ALERTS_PER_DAY);
      const remaining = Math.max(0, dailyCap - addedToday);
      const picked = candidates.slice(0, remaining).map((c) => c.annonce);
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
