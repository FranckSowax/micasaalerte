import { describe, expect, it } from "vitest";
import { archiveReason, archiveReasonLabel, expiryFilter, parutionEnd } from "./archive";

const NOW = new Date("2026-11-18T12:00:00Z");
const withdrawn = { reason: "arnaque", by: "auto", at: "2026-11-17T10:00:00Z" };

describe("archivage", () => {
  it("classe une annonce de plus de 60 h comme expirée", () => {
    expect(archiveReason({ fb_posted_at: "2026-11-15T08:00:00Z" }, NOW)).toBe("expired");
  });

  it("utilise la date de collecte sans date de publication", () => {
    expect(archiveReason({ fb_posted_at: null, created_at: "2026-11-18T08:00:00Z" }, NOW)).toBe("other");
  });

  it("donne priorité au retrait après signalement", () => {
    const annonce = { fb_posted_at: "2026-11-01T08:00:00Z", details: { withdrawn } };
    expect(archiveReason(annonce, NOW)).toBe("withdrawn");
    expect(archiveReasonLabel(annonce, NOW)).toBe("Retirée (arnaque, automatique)");
  });

  it("calcule la fin de parution", () => {
    expect(parutionEnd({ fb_posted_at: "2026-11-15T08:00:00Z" })).toBe("2026-11-17T20:00:00.000Z");
    expect(parutionEnd({})).toBeNull();
  });

  it("construit les filtres de date entre guillemets", () => {
    const cutoff = '"2026-11-16T00:00:00.000Z"';
    expect(expiryFilter(true, NOW)).toBe(`fb_posted_at.lt.${cutoff},and(fb_posted_at.is.null,created_at.lt.${cutoff})`);
    expect(expiryFilter(false, NOW)).toContain("fb_posted_at.gte.");
  });
});
