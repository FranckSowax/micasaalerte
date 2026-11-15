import type { Annonce, ClientDemand } from "@/types/database";
import { matchDemand } from "./matching";
import { subscriptionState } from "./subscription";

// Annonces « à vérifier » : elles correspondent aux critères d'un client, mais un champ décisif
// manque (prix, lieu ou type de transaction). Le cron ne les envoie pas ; l'agent les relit ici
// et décide de les envoyer ou de les écarter.

/** Marqueur d'une annonce écartée par l'agent : elle n'est plus proposée et le client ne la voit pas. */
export const REVIEW_DISMISSED = "review_dismissed";

const DOUBT_LABELS: Record<string, string> = {
  prix: "Prix non indiqué",
  ville: "Lieu non précisé",
  transaction: "Location ou vente non précisée",
  type: "Type de bien non précisé",
  chambres: "Nombre de chambres non précisé",
};

export interface SendKey {
  demand_id: string;
  annonce_id: string;
  annonce_version?: number | null;
}

export interface PendingReview {
  demand: ClientDemand;
  annonce: Annonce;
  score: number;
  /** Points de doute, en clair. */
  doubts: string[];
}

/** Version d'une annonce : augmente quand son prix change. */
export function annonceVersion(annonce: Annonce): number {
  const details = (annonce as unknown as { details?: { version?: unknown } }).details;
  return typeof details?.version === "number" ? details.version : 1;
}

/**
 * Couples client + annonce en attente de vérification, les plus récents d'abord.
 * Sont exclus : les clients inactifs ou dont l'accès est terminé, et les annonces déjà
 * envoyées ou écartées pour ce client.
 *
 * @example const reviews = pendingReviews(demands, annonces, sends)
 */
export function pendingReviews(demands: ClientDemand[], annonces: Annonce[], sends: SendKey[], now: Date = new Date()): PendingReview[] {
  const handled = new Set(sends.map((s) => `${s.demand_id}:${s.annonce_id}:${s.annonce_version ?? 1}`));
  const reviews: PendingReview[] = [];

  for (const demand of demands) {
    if (!demand.is_active || subscriptionState(demand, now).status === "expired") continue;
    for (const annonce of annonces) {
      if (annonce.user_id !== demand.user_id) continue;
      if (handled.has(`${demand.id}:${annonce.id}:${annonceVersion(annonce)}`)) continue;
      const match = matchDemand(annonce, demand);
      if (!match.eligible || !match.needsReview) continue;
      reviews.push({ demand, annonce, score: match.score, doubts: match.uncertain.map((u) => DOUBT_LABELS[u] || u) });
    }
  }

  return reviews.sort((a, b) => String(b.annonce.created_at).localeCompare(String(a.annonce.created_at)));
}
