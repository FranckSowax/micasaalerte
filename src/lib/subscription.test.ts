import { describe, expect, it } from "vitest";
import { extendPaidUntil, findPlan, needsExpiryNotice, planOffer, subscriptionState, SUBSCRIPTION_PLANS, unlimitedPhones } from "./subscription";

const NOW = new Date("2026-11-15T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe("subscriptionState", () => {
  it("sert le client comme avant quand la base n'a pas les colonnes d'abonnement", () => {
    expect(subscriptionState({}, NOW)).toEqual({ status: "active", endsAt: null });
  });

  it("est en essai tant que les 24 h ne sont pas écoulées", () => {
    expect(subscriptionState({ trial_ends_at: hours(5), paid_until: null }, NOW)).toEqual({ status: "trial", endsAt: hours(5) });
  });

  it("expire à la fin de l'essai sans paiement", () => {
    expect(subscriptionState({ trial_ends_at: hours(-1), paid_until: null }, NOW)).toEqual({ status: "expired", endsAt: hours(-1) });
  });

  it("donne la priorité à la période payée", () => {
    expect(subscriptionState({ trial_ends_at: hours(5), paid_until: hours(40) }, NOW)).toEqual({ status: "active", endsAt: hours(40) });
  });

  it("expire après la période payée, et retient la dernière fin", () => {
    expect(subscriptionState({ trial_ends_at: hours(-80), paid_until: hours(-2) }, NOW)).toEqual({ status: "expired", endsAt: hours(-2) });
  });

  it("est expiré sans essai ni paiement", () => {
    expect(subscriptionState({ trial_ends_at: null, paid_until: null }, NOW)).toEqual({ status: "expired", endsAt: null });
  });
});

describe("extendPaidUntil", () => {
  it("part de maintenant quand l'accès est expiré", () => {
    expect(extendPaidUntil({ trial_ends_at: hours(-10), paid_until: null }, NOW)).toBe(hours(48));
  });

  it("ajoute les 2 jours à la fin de l'essai en cours", () => {
    expect(extendPaidUntil({ trial_ends_at: hours(6), paid_until: null }, NOW)).toBe(hours(54));
  });

  it("ajoute les 2 jours à l'abonnement en cours", () => {
    expect(extendPaidUntil({ trial_ends_at: hours(-30), paid_until: hours(12) }, NOW)).toBe(hours(60));
  });
});

describe("needsExpiryNotice", () => {
  it("ne prévient pas un client encore servi", () => {
    expect(needsExpiryNotice({ trial_ends_at: hours(2), paid_until: null }, NOW)).toBe(false);
  });

  it("prévient une fois à l'expiration", () => {
    expect(needsExpiryNotice({ trial_ends_at: hours(-1), paid_until: null, expiry_notified_at: null }, NOW)).toBe(true);
    expect(needsExpiryNotice({ trial_ends_at: hours(-3), paid_until: null, expiry_notified_at: hours(-2) }, NOW)).toBe(false);
  });

  it("prévient à nouveau après un renouvellement lui aussi expiré", () => {
    expect(needsExpiryNotice({ trial_ends_at: hours(-100), paid_until: hours(-1), expiry_notified_at: hours(-70) }, NOW)).toBe(true);
  });
});

describe("formules d'abonnement", () => {
  it("propose 1 jour, 7 jours et 30 jours aux tarifs annoncés", () => {
    expect(SUBSCRIPTION_PLANS.map((p) => [p.id, p.price])).toEqual([
      ["day", 1000],
      ["week", 5000],
      ["month", 15000],
    ]);
    expect(findPlan("week").days).toBe(7);
    expect(findPlan("month").days).toBe(30);
  });

  it("accorde 48 h pour la formule 1 jour pendant la promo de lancement", () => {
    expect(findPlan("day").days).toBe(2);
    expect(planOffer(findPlan("day"))).toBe("1 jour : 1 000 FCFA (promo de lancement : 48 h)");
    expect(planOffer(findPlan("month"))).toBe("30 jours : 15 000 FCFA");
  });

  it("retombe sur la formule 1 jour pour un identifiant inconnu", () => {
    expect(findPlan("inconnu").id).toBe("day");
    expect(findPlan(null).id).toBe("day");
  });

  it("ajoute les jours de la formule choisie", () => {
    expect(extendPaidUntil({ trial_ends_at: hours(-10), paid_until: null }, NOW, findPlan("week").days)).toBe(hours(7 * 24));
  });
});

describe("accès illimités (UNLIMITED_PHONES)", () => {
  const NOW = new Date("2026-11-16T12:00:00Z");
  const list = unlimitedPhones({ UNLIMITED_PHONES: "+241 06 87 13 09, +33 6 24 57 66 20" });

  it("reconnaît les numéros listés, quel que soit le format", () => {
    expect(list).toEqual(new Set(["24106871309", "33624576620"]));
    expect(unlimitedPhones({})).toEqual(new Set());
  });

  it("donne un accès actif sans date de fin, même essai expiré", () => {
    const expired = { trial_ends_at: "2026-11-01T00:00:00Z", paid_until: null };
    expect(subscriptionState({ ...expired, client_phone: "24106871309" }, NOW, list)).toEqual({ status: "active", endsAt: null, unlimited: true });
    expect(subscriptionState({ ...expired, client_phone: "+33624576620" }, NOW, list).unlimited).toBe(true);
    expect(subscriptionState({ ...expired, client_phone: "24177000000" }, NOW, list).status).toBe("expired");
  });
});
