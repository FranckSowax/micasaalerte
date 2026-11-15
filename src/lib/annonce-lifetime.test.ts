import { describe, expect, it } from "vitest";
import { ANNONCE_LIFETIME_HOURS, annonceDate, isExpired, lifetimeCutoff } from "./annonce-lifetime";

const NOW = new Date("2026-11-15T20:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("durée de vie des annonces (60 h)", () => {
  it("vaut 60 heures", () => expect(ANNONCE_LIFETIME_HOURS).toBe(60));

  it("expire après 60 h à compter de la publication", () => {
    expect(isExpired({ fb_posted_at: hoursAgo(59) }, NOW)).toBe(false);
    expect(isExpired({ fb_posted_at: hoursAgo(61) }, NOW)).toBe(true);
  });

  it("se rabat sur la date de collecte quand la publication n'est pas datée", () => {
    expect(isExpired({ fb_posted_at: null, created_at: hoursAgo(70) }, NOW)).toBe(true);
    expect(isExpired({ fb_posted_at: null, created_at: hoursAgo(10) }, NOW)).toBe(false);
    // La publication prime : republiée récemment, collectée il y a longtemps → toujours valable.
    expect(isExpired({ fb_posted_at: hoursAgo(5), created_at: hoursAgo(100) }, NOW)).toBe(false);
  });

  it("ne déclare jamais expirée une annonce sans date lisible", () => {
    expect(isExpired({}, NOW)).toBe(false);
    expect(isExpired({ fb_posted_at: "pas une date" }, NOW)).toBe(false);
    expect(annonceDate({ fb_posted_at: "pas une date", created_at: hoursAgo(1) })).toBe(NOW.getTime() - 3_600_000);
  });

  it("donne la limite au format ISO", () => {
    expect(lifetimeCutoff(NOW)).toBe("2026-11-13T08:00:00.000Z");
  });
});
