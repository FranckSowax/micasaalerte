import { describe, expect, it } from "vitest";
import { businessKpis, trend, type DemandRow, type PaymentRow } from "./business-kpis";

const NOW = new Date("2026-11-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const NONE = new Set<string>();

const demand = (id: string, created: number, extra: Partial<DemandRow> = {}): DemandRow => ({
  id,
  client_phone: `+24107000${id.padStart(3, "0")}`,
  source: "form",
  created_at: daysAgo(created),
  trial_ends_at: daysAgo(created - 1),
  paid_until: null,
  ...extra,
});

const pay = (demand_id: string, ago: number, extra: Partial<PaymentRow> = {}): PaymentRow => ({
  demand_id,
  amount: 1000,
  days: 2,
  status: "confirmed",
  created_at: daysAgo(ago),
  confirmed_at: daysAgo(ago),
  ...extra,
});

describe("businessKpis", () => {
  it("compte inscriptions, nouveaux abonnés et CA sur la période", () => {
    const demands = [demand("1", 3), demand("2", 10), demand("3", 40)];
    const payments = [pay("1", 2), pay("2", 8, { amount: 5000, days: 7 }), pay("2", 1, { amount: 5000, days: 7 }), pay("3", 35)];
    const k = businessKpis(demands, payments, NOW, 30, NONE);
    expect(k.current).toEqual({ signups: 2, newSubscribers: 2, payments: 3, revenue: 11000 });
    expect(k.previous).toEqual({ signups: 1, newSubscribers: 1, payments: 1, revenue: 1000 });
    expect(k.allTimeRevenue).toBe(12000);
  });

  it("ne compte un abonné « nouveau » qu'à son premier paiement", () => {
    const k = businessKpis([demand("1", 50)], [pay("1", 45), pay("1", 5)], NOW, 30, NONE);
    expect(k.current.newSubscribers).toBe(0);
    expect(k.current.payments).toBe(1);
    expect(k.renewalRate).toBe(1);
  });

  it("ignore les paiements en attente ou refusés dans le CA, mais les liste à part", () => {
    const k = businessKpis([demand("1", 3)], [pay("1", 1, { status: "pending" }), pay("1", 1, { status: "rejected" })], NOW, 30, NONE);
    expect(k.current.revenue).toBe(0);
    expect(k.pending).toEqual({ count: 1, amount: 1000 });
  });

  it("exclut les accès illimités de tous les compteurs", () => {
    const demands = [demand("1", 3), demand("2", 3)];
    const unlimited = new Set([demands[1].client_phone!.replace(/\D/g, "")]);
    const k = businessKpis(demands, [pay("2", 1)], NOW, 30, unlimited);
    expect(k.current.signups).toBe(1);
    expect(k.current.revenue).toBe(0);
    expect(k.status.unlimited).toBe(1);
  });

  it("calcule la conversion sur les essais terminés seulement", () => {
    const demands = [
      demand("1", 5), // essai fini, a payé
      demand("2", 5), // essai fini, n'a pas payé
      demand("3", 0, { trial_ends_at: new Date(NOW.getTime() + 3_600_000).toISOString() }), // encore en essai
    ];
    const k = businessKpis(demands, [pay("1", 4)], NOW, 30, NONE);
    expect(k.conversionRate).toBe(0.5);
    expect(k.status.trial).toBe(1);
  });

  it("donne l'état actuel des abonnés", () => {
    const demands = [
      demand("1", 2, { paid_until: daysAgo(-3) }),
      demand("2", 10),
      demand("3", 0, { trial_ends_at: daysAgo(-0.5) }),
    ];
    expect(businessKpis(demands, [], NOW, 30, NONE).status).toEqual({ trial: 1, active: 1, expired: 1, unlimited: 0 });
  });

  it("répartit les paiements par formule et les inscriptions par origine", () => {
    const demands = [demand("1", 3, { source: "chatbot" }), demand("2", 3), demand("3", 3, { source: null })];
    const payments = [pay("1", 1), pay("2", 1, { days: 7, amount: 5000 }), pay("3", 1, { days: 30, amount: 15000 })];
    const k = businessKpis(demands, payments, NOW, 30, NONE);
    expect(k.plans).toEqual({ day: 1, week: 1, month: 1, other: 0 });
    expect(k.sources).toEqual({ chatbot: 1, form: 1, admin: 1 });
    expect(k.averageBasket).toBe(7000);
  });

  it("produit une série quotidienne complète, jours vides compris", () => {
    const k = businessKpis([demand("1", 0)], [pay("1", 0)], NOW, 7, NONE);
    expect(k.daily).toHaveLength(7);
    expect(k.daily.at(-1)).toEqual({ day: "2026-11-19", signups: 1, revenue: 1000 });
    expect(k.daily[0].signups).toBe(0);
  });

  it("reste vide et sans division par zéro sans données", () => {
    const k = businessKpis([], [], NOW, 30, NONE);
    expect(k.conversionRate).toBeNull();
    expect(k.renewalRate).toBeNull();
    expect(k.averageBasket).toBeNull();
  });
});

describe("trend", () => {
  it("donne l'évolution en pourcentage", () => {
    expect(trend(15, 10)).toBe(50);
    expect(trend(5, 10)).toBe(-50);
    expect(trend(3, 0)).toBeNull();
  });
});
