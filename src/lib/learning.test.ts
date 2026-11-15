import { describe, expect, it } from "vitest";
import type { MatchResult } from "./matching";
import { applyLearning, describeProfile, EMPTY_PROFILE, learnProfile, matchingAnalysisPrompt, parseMatchingAnalysis } from "./learning";

const match = (score = 100): MatchResult => ({ eligible: true, blockedBy: [], uncertain: [], needsReview: false, clientCanCheck: false, decisiveDoubts: [], score, reasons: [] });
const avis = (feedback: string, annonce: { quartier?: string | null; type_bien?: string | null; prix?: number | null }) => ({ feedback, annonce });

describe("apprentissage à partir des avis d'un abonné", () => {
  it("ne tire rien d'un refus isolé", () => {
    const profile = learnProfile([avis("quartier", { quartier: "PK12" })]);
    expect(profile.dislikedQuartiers).toEqual([]);
    expect(applyLearning(match(), { quartier: "PK12" }, profile).score).toBe(100);
  });

  it("pénalise un quartier écarté à répétition", () => {
    const profile = learnProfile([avis("quartier", { quartier: "PK 12" }), avis("quartier", { quartier: "pk 12" })]);
    expect(profile.dislikedQuartiers).toEqual(["pk 12"]);
    const m = applyLearning(match(), { quartier: "PK 12" }, profile);
    expect(m.score).toBe(70);
    expect(m.reasons.join(" ")).toContain("écarté à plusieurs reprises");
    expect(m.eligible).toBe(true);
  });

  it("n'écarte pas un quartier que l'abonné a aussi jugé pertinent", () => {
    const profile = learnProfile([avis("quartier", { quartier: "Okala" }), avis("quartier", { quartier: "Okala" }), avis("pertinente", { quartier: "Okala" })]);
    expect(profile.dislikedQuartiers).toEqual([]);
    expect(applyLearning(match(80), { quartier: "Okala" }, profile).score).toBe(90);
  });

  it("pénalise un type de bien écarté à répétition", () => {
    const profile = learnProfile([avis("type", { type_bien: "chambre" }), avis("type", { type_bien: "chambre" })]);
    expect(applyLearning(match(), { type_bien: "chambre" }, profile).score).toBe(70);
    expect(applyLearning(match(), { type_bien: "studio" }, profile).score).toBe(100);
  });

  it("apprend un plafond de prix plus bas que le budget déclaré", () => {
    const profile = learnProfile([avis("prix", { prix: 300000 }), avis("prix", { prix: 320000 }), avis("pertinente", { prix: 200000 })]);
    expect(profile.priceCeiling).toBe(300000);
    expect(applyLearning(match(), { prix: 310000 }, profile).score).toBe(75);
    expect(applyLearning(match(), { prix: 250000 }, profile).score).toBe(100);
  });

  it("ignore un plafond contredit par une annonce plus chère jugée pertinente", () => {
    const profile = learnProfile([avis("prix", { prix: 300000 }), avis("prix", { prix: 320000 }), avis("pertinente", { prix: 340000 })]);
    expect(profile.priceCeiling).toBeNull();
  });

  it("calcule la part d'annonces pertinentes et ignore les signalements", () => {
    const profile = learnProfile([avis("pertinente", {}), avis("prix", { prix: 1 }), avis("arnaque", {}), avis("indisponible", {})]);
    expect(profile.samples).toBe(2);
    expect(profile.precision).toBe(0.5);
    expect(learnProfile([avis("arnaque", {})])).toEqual(EMPTY_PROFILE);
  });

  it("cumule les pénalités sans sortir de 0 à 100", () => {
    const profile = learnProfile([
      avis("quartier", { quartier: "PK12" }), avis("quartier", { quartier: "PK12" }),
      avis("type", { type_bien: "chambre" }), avis("type", { type_bien: "chambre" }),
    ]);
    expect(applyLearning(match(40), { quartier: "PK12", type_bien: "chambre" }, profile).score).toBe(0);
    expect(describeProfile(profile)).toHaveLength(2);
  });
});

describe("analyse du matching par le modèle", () => {
  it("ne transmet que des critères et des comptes, tronqués", () => {
    const prompt = matchingAnalysisPrompt({
      stats: { pertinente: 3, prix: 5 },
      subscribers: [{ criteria: { offre: ["location"], prixMax: 350000 }, feedback: { prix: 5 }, learned: [] }],
      refusals: Array.from({ length: 200 }, () => ({ reason: "prix", annonce: "x".repeat(200) })),
    });
    expect(prompt).toContain("N'invente rien");
    expect(prompt).toContain('"prix":5');
    expect(prompt.length).toBeLessThan(9000);
  });

  it("lit la réponse du modèle et rejette une réponse sans raisonnement", () => {
    const a = parseMatchingAnalysis('{"raisonnement":"Peu de données.","constats":["5 refus pour le prix"],"recommandations":["Demander le budget réel"]}');
    expect(a?.findings).toEqual(["5 refus pour le prix"]);
    expect(a?.recommendations).toEqual(["Demander le budget réel"]);
    expect(parseMatchingAnalysis('{"constats":[]}')).toBeNull();
    expect(parseMatchingAnalysis("rien")).toBeNull();
  });
});
