import type { createServiceClient } from "./supabase/server";

// Durée de vie d'une annonce : au-delà, elle n'est plus affichée ni envoyée, puis elle est archivée.
// WHY: un bien intéressant part en quelques jours ; une annonce de plus de 60 heures a toutes les
// chances d'être déjà louée ou vendue, et l'envoyer décevrait l'abonné.

type Client = ReturnType<typeof createServiceClient>;

/** Durée de vie d'une annonce, en heures, à compter de sa publication. */
export const ANNONCE_LIFETIME_HOURS = 60;
const LIFETIME_MS = ANNONCE_LIFETIME_HOURS * 3_600_000;

interface Dated {
  fb_posted_at?: string | null;
  created_at?: string | null;
}

/** Date de référence : la publication, ou à défaut la collecte. Null si aucune n'est lisible. */
export function annonceDate(annonce: Dated): number | null {
  for (const value of [annonce.fb_posted_at, annonce.created_at]) {
    const time = value ? new Date(value).getTime() : NaN;
    if (Number.isFinite(time)) return time;
  }
  return null;
}

/**
 * L'annonce a-t-elle dépassé sa durée de vie ? Une annonce sans date n'est jamais considérée expirée.
 *
 * @example isExpired({ fb_posted_at: "2026-11-12T08:00:00Z" }, new Date("2026-11-15T08:00:00Z")) // true (72 h)
 */
export function isExpired(annonce: Dated, now: Date = new Date()): boolean {
  const date = annonceDate(annonce);
  return date !== null && now.getTime() - date > LIFETIME_MS;
}

/** Limite au format ISO : les annonces publiées avant sont expirées. */
export function lifetimeCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - LIFETIME_MS).toISOString();
}

/**
 * Archive les annonces expirées encore « nouvelles » ou « envoyées ». Les favoris sont laissés :
 * l'agent les a choisis. Rien n'est supprimé, l'annonce reste consultable dans « Archivé ».
 *
 * @returns nombre d'annonces archivées
 */
export async function archiveExpired(client: Client, now: Date = new Date()): Promise<number> {
  const cutoff = lifetimeCutoff(now);
  const [byPublication, byCollection] = await Promise.all([
    client.from("annonces").update({ status: "archived" }).in("status", ["new", "sent"]).lt("fb_posted_at", cutoff).select("id"),
    client.from("annonces").update({ status: "archived" }).in("status", ["new", "sent"]).is("fb_posted_at", null).lt("created_at", cutoff).select("id"),
  ]);
  return (byPublication.data?.length || 0) + (byCollection.data?.length || 0);
}
