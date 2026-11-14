// Abonnement d'un client : essai gratuit de 24 h, puis 1 000 FCFA pour 2 jours de réception.
// Règles pures (sans base ni réseau) pour être testées et partagées entre le cron,
// l'espace client et l'écran d'administration.

export const SUBSCRIPTION_PRICE_FCFA = 1000;
export const SUBSCRIPTION_DAYS = 2;
export const TRIAL_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionStatus = "trial" | "active" | "expired";

export interface SubscriptionFields {
  /** Fin de l'essai gratuit. Absent (undefined) si la migration SQL n'a pas été exécutée. */
  trial_ends_at?: string | null;
  /** Fin de la période payée en cours. */
  paid_until?: string | null;
  /** Dernier message « abonnement terminé » envoyé. */
  expiry_notified_at?: string | null;
}

export interface SubscriptionState {
  status: SubscriptionStatus;
  /** Fin de la période en cours, ou de la dernière période si l'accès est expiré. */
  endsAt: string | null;
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * État de l'abonnement d'un client à un instant donné.
 * Une période payée prime sur l'essai. Sans les colonnes d'abonnement (base non migrée),
 * le client reste servi comme avant.
 *
 * @example subscriptionState(demand).status === "expired"
 */
export function subscriptionState(demand: SubscriptionFields, now: Date = new Date()): SubscriptionState {
  if (demand.trial_ends_at === undefined && demand.paid_until === undefined) {
    return { status: "active", endsAt: null };
  }
  const nowMs = now.getTime();
  const paid = toMs(demand.paid_until);
  const trial = toMs(demand.trial_ends_at);

  if (paid !== null && paid > nowMs) return { status: "active", endsAt: new Date(paid).toISOString() };
  if (trial !== null && trial > nowMs) return { status: "trial", endsAt: new Date(trial).toISOString() };

  const last = Math.max(paid ?? 0, trial ?? 0);
  return { status: "expired", endsAt: last > 0 ? new Date(last).toISOString() : null };
}

/**
 * Nouvelle date de fin après un paiement. Les jours payés s'ajoutent à ce qui reste
 * (essai ou abonnement en cours) : payer en avance ne fait rien perdre au client.
 *
 * @example extendPaidUntil(demand) // maintenant + 2 jours si l'accès est expiré
 */
export function extendPaidUntil(demand: SubscriptionFields, now: Date = new Date(), days: number = SUBSCRIPTION_DAYS): string {
  const base = Math.max(now.getTime(), toMs(demand.paid_until) ?? 0, toMs(demand.trial_ends_at) ?? 0);
  return new Date(base + days * DAY_MS).toISOString();
}

/**
 * Faut-il prévenir le client que son accès est terminé ? Une seule fois par période :
 * après un renouvellement puis une nouvelle expiration, il est prévenu à nouveau.
 */
export function needsExpiryNotice(demand: SubscriptionFields, now: Date = new Date()): boolean {
  const state = subscriptionState(demand, now);
  if (state.status !== "expired") return false;
  const notified = toMs(demand.expiry_notified_at);
  if (notified === null) return true;
  const end = toMs(state.endsAt);
  return end !== null && notified < end;
}

/** Date lisible à l'heure de Libreville, pour les messages WhatsApp. */
export function formatDeadline(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Libreville",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Consignes de paiement affichées au client (numéro Mobile Money, nom du bénéficiaire). */
export function paymentInfo(): string | null {
  return process.env.SUBSCRIPTION_PAYMENT_INFO?.trim() || null;
}
