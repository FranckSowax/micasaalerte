import { describe, expect, it } from "vitest";
import type { Annonce, ClientDemand } from "@/types/database";
import { annonceVersion, pendingReviews } from "./review";

const NOW = new Date("2026-11-15T12:00:00Z");

function annonce(overrides: Record<string, unknown> = {}): Annonce {
  return {
    id: "a1",
    user_id: "u1",
    type_offre: "location",
    type_bien: "appartement",
    prix: 250000,
    nb_chambres: 2,
    quartier: "Okala",
    ville: "Libreville",
    raw_text: "Bel appartement calme",
    ai_summary: "",
    ai_tags: [],
    created_at: "2026-11-15T10:00:00Z",
    ...overrides,
  } as unknown as Annonce;
}

function demand(overrides: Partial<ClientDemand> = {}): ClientDemand {
  return {
    id: "d1",
    user_id: "u1",
    client_phone: "24177123456",
    client_name: "Awa",
    is_active: true,
    filter_type_offre: ["location"],
    filter_type_bien: ["appartement"],
    filter_prix_min: null,
    filter_prix_max: 300000,
    filter_nb_chambres_min: null,
    filter_quartiers: [],
    filter_ville: "Libreville",
    filter_meuble: null,
    exigences: null,
    source: "form",
    last_message_at: null,
    created_at: "2026-11-14T10:00:00Z",
    updated_at: "2026-11-14T10:00:00Z",
    ...overrides,
  } as ClientDemand;
}

describe("pendingReviews", () => {
  it("retient une annonce qui correspond mais dont le prix manque", () => {
    const reviews = pendingReviews([demand()], [annonce({ prix: null })], [], NOW);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].doubts).toContain("Prix non indiqué");
  });

  it("ignore une annonce complète (envoyée automatiquement) et une annonce hors critères", () => {
    expect(pendingReviews([demand()], [annonce()], [], NOW)).toHaveLength(0);
    expect(pendingReviews([demand()], [annonce({ prix: null, type_offre: "vente" })], [], NOW)).toHaveLength(0);
  });

  it("ignore une annonce déjà envoyée ou écartée pour ce client", () => {
    const sends = [{ demand_id: "d1", annonce_id: "a1" }];
    expect(pendingReviews([demand()], [annonce({ prix: null })], sends, NOW)).toHaveLength(0);
  });

  it("propose à nouveau une annonce dont la version a changé", () => {
    const sends = [{ demand_id: "d1", annonce_id: "a1", annonce_version: 1 }];
    const updated = annonce({ prix: null, details: { version: 2 } });
    expect(annonceVersion(updated)).toBe(2);
    expect(pendingReviews([demand()], [updated], sends, NOW)).toHaveLength(1);
  });

  it("ignore les clients inactifs, expirés ou d'un autre compte", () => {
    const a = [annonce({ prix: null })];
    expect(pendingReviews([demand({ is_active: false })], a, [], NOW)).toHaveLength(0);
    expect(pendingReviews([demand({ trial_ends_at: "2026-11-14T00:00:00Z", paid_until: null })], a, [], NOW)).toHaveLength(0);
    expect(pendingReviews([demand({ user_id: "u2" })], a, [], NOW)).toHaveLength(0);
  });

  it("classe les annonces les plus récentes d'abord", () => {
    const reviews = pendingReviews(
      [demand()],
      [annonce({ id: "ancien", prix: null, created_at: "2026-11-10T10:00:00Z" }), annonce({ id: "recent", prix: null })],
      [],
      NOW
    );
    expect(reviews.map((r) => r.annonce.id)).toEqual(["recent", "ancien"]);
  });
});
