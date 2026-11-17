import { ANNONCE_LIFETIME_HOURS, annonceDate, isExpired, lifetimeCutoff } from "./annonce-lifetime";
import { FEEDBACK_LABELS, withdrawalOf } from "./reports";

// Page « Archivage » de l'administration : pourquoi une annonce archivée l'a été, et filtres
// PostgREST correspondants. Les annonces ne sont jamais supprimées : l'archivage est un statut.

/** Motifs d'archivage affichés et filtrables. */
export const ARCHIVE_REASONS = ["expired", "withdrawn", "other"] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  expired: "Délai de parution dépassé",
  withdrawn: "Retirée après signalement",
  other: "Archivée à la main ou doublon",
};

interface ArchivedAnnonce {
  fb_posted_at?: string | null;
  created_at?: string | null;
  details?: Record<string, unknown> | null;
}

/**
 * Motif d'archivage. Un retrait après signalement l'emporte sur l'expiration : c'est l'information
 * la plus utile à l'agent.
 *
 * @example archiveReason({ fb_posted_at: "2026-11-01T08:00:00Z" }) // "expired"
 */
export function archiveReason(annonce: ArchivedAnnonce, now: Date = new Date()): ArchiveReason {
  if (withdrawalOf(annonce.details)) return "withdrawn";
  return isExpired(annonce, now) ? "expired" : "other";
}

/** Libellé détaillé du motif, avec la raison du retrait quand il y en a une. */
export function archiveReasonLabel(annonce: ArchivedAnnonce, now: Date = new Date()): string {
  const withdrawal = withdrawalOf(annonce.details);
  if (withdrawal) {
    const by = withdrawal.by === "auto" ? "automatique" : "par un agent";
    return `Retirée (${FEEDBACK_LABELS[withdrawal.reason].toLowerCase()}, ${by})`;
  }
  return ARCHIVE_REASON_LABELS[archiveReason(annonce, now)];
}

/** Fin de parution : publication (ou collecte) + durée de vie. Null si l'annonce n'a pas de date. */
export function parutionEnd(annonce: ArchivedAnnonce): string | null {
  const date = annonceDate(annonce);
  return date === null ? null : new Date(date + ANNONCE_LIFETIME_HOURS * 3_600_000).toISOString();
}

/**
 * Filtre `or` PostgREST sur la date de l'annonce : expirée (`expired: true`) ou encore dans son délai.
 * Les dates sont entre guillemets : « : » et « . » sont réservés dans un filtre `or`.
 */
export function expiryFilter(expired: boolean, now: Date = new Date()): string {
  const cutoff = `"${lifetimeCutoff(now)}"`;
  const op = expired ? "lt" : "gte";
  return `fb_posted_at.${op}.${cutoff},and(fb_posted_at.is.null,created_at.${op}.${cutoff})`;
}
