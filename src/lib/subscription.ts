// Abonnement d'un client : essai gratuit de 24 h, puis une formule 1 jour, 7 jours ou 30 jours.
// Règles pures (sans base ni réseau) pour être testées et partagées entre le cron,
// l'espace client et l'écran d'administration.

/** Promo de lancement : la formule 1 jour donne 48 h. Passer à false pour revenir à 24 h. */
export const LAUNCH_PROMO = true;

export interface SubscriptionPlan {
  id: "day" | "week" | "month";
  label: string;
  price: number;
  /** Jours de réception réellement accordés (promo comprise). */
  days: number;
  note?: string;
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    id: "day",
    label: "1 jour",
    price: 1000,
    days: LAUNCH_PROMO ? 2 : 1,
    ...(LAUNCH_PROMO ? { note: "Promo de lancement : 48 h au prix d'un jour" } : {}),
  },
  { id: "week", label: "7 jours", price: 5000, days: 7 },
  { id: "month", label: "30 jours", price: 15000, days: 30 },
];

export const PLAN_IDS = ["day", "week", "month"] as const;
export const DEFAULT_PLAN = SUBSCRIPTION_PLANS[0];

/** Formule d'entrée, pour les textes « à partir de ». */
export const SUBSCRIPTION_PRICE_FCFA = DEFAULT_PLAN.price;
export const SUBSCRIPTION_DAYS = DEFAULT_PLAN.days;
export const TRIAL_HOURS = 24;

/** Formule correspondant à un identifiant ; la formule 1 jour par défaut. */
export function findPlan(id: string | null | undefined): SubscriptionPlan {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === id) ?? DEFAULT_PLAN;
}

/**
 * Formule en une ligne, pour les écrans et les messages WhatsApp.
 *
 * @example planOffer(findPlan("week")) // "7 jours : 5 000 FCFA"
 */
export function planOffer(plan: SubscriptionPlan): string {
  // Espace simple comme séparateur de milliers : lisible partout, y compris sur WhatsApp.
  const price = plan.price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const promo = plan.id === "day" && LAUNCH_PROMO ? " (promo de lancement : 48 h)" : "";
  return `${plan.label} : ${price} FCFA${promo}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionStatus = "trial" | "active" | "expired";

export interface SubscriptionFields {
  /** Fin de l'essai gratuit. Absent (undefined) si la migration SQL n'a pas été exécutée. */
  trial_ends_at?: string | null;
  /** Fin de la période payée en cours. */
  paid_until?: string | null;
  /** Dernier message « abonnement terminé » envoyé. */
  expiry_notified_at?: string | null;
  /** Numéro WhatsApp de l'abonné : sert à reconnaître les accès illimités (UNLIMITED_PHONES). */
  client_phone?: string | null;
}

export interface SubscriptionState {
  status: SubscriptionStatus;
  /** Fin de la période en cours, ou de la dernière période si l'accès est expiré. */
  endsAt: string | null;
  /** Accès illimité (démonstration, équipe) : pas de date de fin. */
  unlimited?: boolean;
}

const digits = (v: string | null | undefined) => (v || "").replace(/\D/g, "");

/**
 * Numéros à accès illimité (démonstration, équipe), lus dans la variable UNLIMITED_PHONES
 * (séparés par des virgules ou des espaces). WHY: les numéros restent hors du code et du dépôt public.
 *
 * @example unlimitedPhones({ UNLIMITED_PHONES: "+241 06 87 13 09, +33 6 24 57 66 20" })
 */
export function unlimitedPhones(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): Set<string> {
  return new Set((env.UNLIMITED_PHONES || "").split(/[,;\n]+/).map(digits).filter((d) => d.length >= 8));
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
export function subscriptionState(demand: SubscriptionFields, now: Date = new Date(), unlimited: Set<string> = unlimitedPhones()): SubscriptionState {
  const phone = digits(demand.client_phone);
  if (phone && unlimited.has(phone)) return { status: "active", endsAt: null, unlimited: true };
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

