import type { createServiceClient } from "@/lib/supabase/server";
import { DEFAULT_MAX_ALERTS_PER_DAY, matchDemand, shouldSend, shouldSendForCheck, startOfLocalDayIso } from "@/lib/matching";
import { annonceVersion } from "@/lib/review";
import { subscriptionState } from "@/lib/subscription";
import type { Annonce, ClientDemand } from "@/types/database";

// Sélection immédiate pour un abonné, hors passage horaire : à l'inscription (première sélection)
// et après une modification de critères. Mêmes règles que le cron : pas de doublon, plafond
// quotidien, annonces complètes ou à une seule information manquante.

const RECENT_ANNONCES = 200;

type Client = ReturnType<typeof createServiceClient>;
type Row = Record<string, unknown>;

/**
 * Annonces récentes qui correspondent aux critères de l'abonné et qu'il n'a pas encore reçues,
 * les mieux notées d'abord. Vide si son accès est terminé.
 *
 * @example const picked = await pickForDemand(supabase, demand)
 */
export async function pickForDemand(supabase: Client, demand: ClientDemand, now: Date = new Date()): Promise<Annonce[]> {
  if (subscriptionState(demand, now).status === "expired") return [];

  const [{ data: rows }, { data: sends }] = await Promise.all([
    supabase
      .from("annonces")
      .select("*")
      .eq("user_id", demand.user_id)
      .eq("ai_is_real_estate", true)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(RECENT_ANNONCES),
    supabase.from("client_demand_sends").select("*").eq("demand_id", demand.id),
  ]);

  const known = new Set(((sends || []) as Row[]).map((s) => `${s.annonce_id}:${s.annonce_version ?? 1}`));
  const dayStart = startOfLocalDayIso(now);
  const addedToday = ((sends || []) as Row[]).filter((s) => s.status !== "failed" && typeof s.sent_at === "string" && s.sent_at >= dayStart).length;
  // Même plancher que le cron : l'ancien plafond enregistré en base (30) ne s'applique plus.
  const cap = Math.max(demand.max_alerts_per_day ?? DEFAULT_MAX_ALERTS_PER_DAY, DEFAULT_MAX_ALERTS_PER_DAY);

  const candidates: { annonce: Annonce; score: number }[] = [];
  for (const annonce of (rows || []) as unknown as Annonce[]) {
    if (known.has(`${annonce.id}:${annonceVersion(annonce)}`)) continue;
    const match = matchDemand(annonce, demand);
    if (shouldSend(match, demand) || shouldSendForCheck(match, demand)) candidates.push({ annonce, score: match.score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, Math.max(0, cap - addedToday)).map((c) => c.annonce);
}

/**
 * Enregistre les annonces dans l'espace de l'abonné. `messageId` : identifiant du message WhatsApp
 * qui les annonce, ou un marqueur (« criteria_refresh », « signup ») quand aucun message n'est parti.
 * Renvoie le nombre d'annonces réellement ajoutées.
 */
export async function recordSelection(supabase: Client, demand: ClientDemand, annonces: Annonce[], messageId: string): Promise<number> {
  let added = 0;
  for (const annonce of annonces) {
    const row = { demand_id: demand.id, annonce_id: annonce.id, message_id: messageId, status: "sent" };
    const version = annonceVersion(annonce);
    let { error } = version === 1 ? await supabase.from("client_demand_sends").insert(row) : await supabase.from("client_demand_sends").insert({ ...row, annonce_version: version });
    // Base sans la colonne annonce_version : on enregistre quand même.
    if (error && version !== 1) ({ error } = await supabase.from("client_demand_sends").insert(row));
    if (!error) added++;
  }
  return added;
}
