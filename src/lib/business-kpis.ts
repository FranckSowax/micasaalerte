import { ALERT_TIMEZONE } from "./matching";
import { subscriptionState, unlimitedPhones } from "./subscription";

// Indicateurs commerciaux du tableau de bord : inscriptions gratuites, nouveaux abonnés payants,
// chiffre d'affaires, conversion, réabonnement. Calcul pur (sans base) pour être testé.
// WHY: les accès illimités (démonstration, équipe) sont exclus partout, sinon ils gonflent
// les « actifs » sans jamais rien payer.

export interface DemandRow {
  id: string;
  client_phone: string | null;
  source: string | null;
  created_at: string | null;
  trial_ends_at?: string | null;
  paid_until?: string | null;
}

export interface PaymentRow {
  demand_id: string;
  amount: number | null;
  days: number | null;
  status: string | null;
  created_at: string | null;
  confirmed_at: string | null;
}

export interface PeriodKpis {
  /** Inscriptions (essais gratuits démarrés) sur la période. */
  signups: number;
  /** Abonnés dont le premier paiement validé tombe dans la période. */
  newSubscribers: number;
  /** Paiements validés sur la période (premiers et renouvellements). */
  payments: number;
  /** Chiffre d'affaires encaissé (paiements validés), en FCFA. */
  revenue: number;
}

export interface DayPoint {
  /** AAAA-MM-JJ, heure de Libreville. */
  day: string;
  signups: number;
  revenue: number;
}

export interface BusinessKpis {
  current: PeriodKpis;
  previous: PeriodKpis;
  periodDays: number;
  /** CA encaissé depuis le 1er du mois (heure de Libreville). */
  monthRevenue: number;
  allTimeRevenue: number;
  status: { trial: number; active: number; expired: number; unlimited: number };
  pending: { count: number; amount: number };
  /** Part des inscrits (essai terminé) ayant payé au moins une fois, de 0 à 1. */
  conversionRate: number | null;
  /** Part des payants ayant payé au moins deux fois, de 0 à 1. */
  renewalRate: number | null;
  /** Montant moyen d'un paiement validé, en FCFA. */
  averageBasket: number | null;
  /** Paiements validés par formule (selon le nombre de jours). */
  plans: { day: number; week: number; month: number; other: number };
  /** Inscriptions par origine. */
  sources: Record<string, number>;
  daily: DayPoint[];
}

const DAY_MS = 86_400_000;

function localDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ALERT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

const digits = (v: string | null | undefined) => (v || "").replace(/\D/g, "");

/** Date de validation d'un paiement (à défaut, sa date de déclaration). */
function paidAt(p: PaymentRow): number | null {
  return ms(p.confirmed_at) ?? ms(p.created_at);
}

function planOf(days: number | null): keyof BusinessKpis["plans"] {
  if (days === 1 || days === 2) return "day";
  if (days === 7) return "week";
  if (days === 30) return "month";
  return "other";
}

/**
 * Calcule les indicateurs commerciaux sur les `periodDays` derniers jours, comparés à la période précédente.
 *
 * @example businessKpis(demandes, paiements, new Date(), 30).current.revenue // 45000
 */
export function businessKpis(
  demands: DemandRow[],
  payments: PaymentRow[],
  now: Date = new Date(),
  periodDays = 30,
  unlimited: Set<string> = unlimitedPhones(),
): BusinessKpis {
  const nowMs = now.getTime();
  const startCurrent = nowMs - periodDays * DAY_MS;
  const startPrevious = startCurrent - periodDays * DAY_MS;

  const excluded = new Set(demands.filter((d) => unlimited.has(digits(d.client_phone))).map((d) => d.id));
  const counted = demands.filter((d) => !excluded.has(d.id));
  const confirmed = payments.filter((p) => p.status === "confirmed" && !excluded.has(p.demand_id));

  // Premier paiement validé de chaque abonné : définit la date où il devient « nouvel abonné ».
  const firstPaid = new Map<string, number>();
  const paymentsPerDemand = new Map<string, number>();
  for (const p of confirmed) {
    const t = paidAt(p);
    if (t === null) continue;
    paymentsPerDemand.set(p.demand_id, (paymentsPerDemand.get(p.demand_id) ?? 0) + 1);
    const prev = firstPaid.get(p.demand_id);
    if (prev === undefined || t < prev) firstPaid.set(p.demand_id, t);
  }

  const period = (from: number, to: number): PeriodKpis => {
    const inRange = (t: number | null) => t !== null && t >= from && t < to;
    const paid = confirmed.filter((p) => inRange(paidAt(p)));
    return {
      signups: counted.filter((d) => inRange(ms(d.created_at))).length,
      newSubscribers: Array.from(firstPaid.values()).filter((t) => inRange(t)).length,
      payments: paid.length,
      revenue: paid.reduce((sum, p) => sum + (p.amount ?? 0), 0),
    };
  };

  // Libreville : UTC+1 toute l'année (pas d'heure d'été).
  const monthStart = Date.parse(`${localDay(now).slice(0, 8)}01T00:00:00+01:00`);
  const monthRevenue = confirmed.filter((p) => (paidAt(p) ?? 0) >= monthStart).reduce((s, p) => s + (p.amount ?? 0), 0);
  const allTimeRevenue = confirmed.reduce((s, p) => s + (p.amount ?? 0), 0);

  const status = { trial: 0, active: 0, expired: 0, unlimited: excluded.size };
  for (const d of counted) status[subscriptionState(d, now, new Set()).status]++;

  const pendingRows = payments.filter((p) => p.status === "pending" && !excluded.has(p.demand_id));
  const pending = { count: pendingRows.length, amount: pendingRows.reduce((s, p) => s + (p.amount ?? 0), 0) };

  // Conversion : seuls les inscrits dont l'essai est terminé ont eu le temps de décider.
  const decided = counted.filter((d) => {
    const trialEnd = ms(d.trial_ends_at);
    return firstPaid.has(d.id) || (trialEnd !== null && trialEnd <= nowMs);
  });
  const conversionRate = decided.length ? decided.filter((d) => firstPaid.has(d.id)).length / decided.length : null;
  const payers = Array.from(paymentsPerDemand.values());
  const renewalRate = payers.length ? payers.filter((n) => n >= 2).length / payers.length : null;
  const averageBasket = confirmed.length ? Math.round(allTimeRevenue / confirmed.length) : null;

  const plans = { day: 0, week: 0, month: 0, other: 0 };
  for (const p of confirmed) plans[planOf(p.days)]++;

  const sources: Record<string, number> = {};
  for (const d of counted) {
    const key = d.source || "admin";
    sources[key] = (sources[key] ?? 0) + 1;
  }

  const daily: DayPoint[] = [];
  const index = new Map<string, DayPoint>();
  for (let i = periodDays - 1; i >= 0; i--) {
    const day = localDay(new Date(nowMs - i * DAY_MS));
    if (index.has(day)) continue;
    const point = { day, signups: 0, revenue: 0 };
    index.set(day, point);
    daily.push(point);
  }
  for (const d of counted) {
    const t = ms(d.created_at);
    const point = t !== null ? index.get(localDay(new Date(t))) : undefined;
    if (point) point.signups++;
  }
  for (const p of confirmed) {
    const t = paidAt(p);
    const point = t !== null ? index.get(localDay(new Date(t))) : undefined;
    if (point) point.revenue += p.amount ?? 0;
  }

  return {
    current: period(startCurrent, nowMs + 1),
    previous: period(startPrevious, startCurrent),
    periodDays,
    monthRevenue,
    allTimeRevenue,
    status,
    pending,
    conversionRate,
    renewalRate,
    averageBasket,
    plans,
    sources,
    daily,
  };
}

/** Évolution en pourcentage par rapport à la période précédente ; null si rien avant. */
export function trend(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}
