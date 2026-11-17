import { describe, expect, it } from "vitest";
import { decisionRow, isShownToClient } from "./client-decision";

// Tri de l'abonné : « Supprimer » efface l'annonce de son espace sans perdre son avis.

const NOW = "2026-11-17T20:00:00.000Z";

describe("décision de l'abonné sur une annonce", () => {
  it("garde l'avis déjà donné quand l'annonce est supprimée", () => {
    expect(decisionRow("delete", undefined, NOW)).toEqual({ client_status: "deleted", decided_at: NOW });
    expect(decisionRow("delete", "prix", NOW)).not.toHaveProperty("client_feedback");
  });

  it("enregistre l'avis qui accompagne un écart ou un intérêt", () => {
    expect(decisionRow("remove", "quartier", NOW)).toEqual({ client_status: "removed", decided_at: NOW, client_feedback: "quartier" });
    expect(decisionRow("keep", "pertinente", NOW)).toEqual({ client_status: "kept", decided_at: NOW, client_feedback: "pertinente" });
    expect(decisionRow("remove", undefined, NOW).client_feedback).toBeNull();
  });

  it("efface l'avis quand l'annonce redevient à trier", () => {
    expect(decisionRow("reset", "prix", NOW)).toEqual({ client_status: "new", decided_at: NOW, client_feedback: null });
  });

  it("n'affiche plus une annonce supprimée", () => {
    expect(isShownToClient("deleted")).toBe(false);
    expect(isShownToClient("removed")).toBe(true);
    expect(isShownToClient(null)).toBe(true);
  });
});
