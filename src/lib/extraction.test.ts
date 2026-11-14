import { describe, expect, it } from "vitest";
import { sanitizeExtraction, toTags } from "./extraction";

const SOURCE =
  "Studio meublé à louer à Okala, 150k par mois, caution 2 mois soit 300 000. Climatisé, parking. Appelez le 077 12 34 56";

const good = {
  est_immobilier: true,
  transaction: "location_meublee",
  type: "studio",
  prix: 150000,
  devise: "FCFA",
  periodicite: "mois",
  caution: 300000,
  quartier: "Okala",
  nb_chambres: 1,
  meuble: true,
  climatise: true,
  parking: true,
  description: "Studio meublé à louer à Okala.",
  caracteristiques: ["gardien"],
  confiance: { transaction: 0.95, type: 0.9, prix: 0.9, quartier: 0.8 },
  extraits: { prix: "150k", caution: "300 000", quartier: "Okala", immobilier: "Studio meublé à louer" },
};

describe("sanitizeExtraction", () => {
  it("conserve les champs justifiés par la source", () => {
    const e = sanitizeExtraction(good, SOURCE);
    expect(e.prix).toBe(150000);
    expect(e.caution).toBe(300000);
    expect(e.quartier).toBe("Okala");
    expect(e.devise).toBe("XAF");
    expect(e.meuble).toBe(true);
    expect(e.rejets).toEqual([]);
    expect(e.extraits.prix).toBe("150k");
  });

  it("remet à null un quartier inventé (extrait absent de la source)", () => {
    const e = sanitizeExtraction({ ...good, quartier: "Angondjé", extraits: { ...good.extraits, quartier: "Angondjé" } }, SOURCE);
    expect(e.quartier).toBeNull();
    expect(e.rejets).toContain("quartier");
    expect(e.confiance.quartier).toBe(0);
  });

  it("remet à null un prix sans extrait", () => {
    const e = sanitizeExtraction({ ...good, extraits: { quartier: "Okala" } }, SOURCE);
    expect(e.prix).toBeNull();
    expect(e.devise).toBeNull();
    expect(e.rejets).toContain("prix");
    expect(e.a_verifier).toContain("prix");
  });

  it("n'attribue pas de ville par défaut", () => {
    const e = sanitizeExtraction({ ...good, ville: "Libreville", extraits: { ...good.extraits, ville: "Libreville" } }, SOURCE);
    expect(e.ville).toBeNull();
    expect(e.rejets).toContain("ville");
  });

  it("refuse une publication classée immobilière sans passage du texte qui le montre", () => {
    // Cas réel : publicité pour une prépa, postée dans un groupe « Maison à louer angondje ».
    const pub = "Chers élèves, venez vous inscrire à la Prépa pour le BACCALAUREAT et le BEPC depuis le 9 novembre";
    const raw = { est_immobilier: true, transaction: "location", type: "maison", quartier: "Angondjé",
      description: "Maison à louer à Angondjé.", extraits: { immobilier: "Maison à louer angondje", quartier: "angondje" } };
    const e = sanitizeExtraction(raw, pub);
    expect(e.est_immobilier).toBe(false);
    expect(e.quartier).toBeNull();
    expect(e.rejets).toEqual(expect.arrayContaining(["immobilier", "quartier"]));
  });

  it("refuse est_immobilier quand l'extrait manque", () => {
    const { immobilier: _unused, ...sansPreuve } = good.extraits;
    expect(sanitizeExtraction({ ...good, extraits: sansPreuve }, SOURCE).est_immobilier).toBe(false);
  });

  it("marque hors Gabon un bien situé à Abidjan, même si le modèle ne le signale pas", () => {
    const e = sanitizeExtraction({ ...good, extraits: { immobilier: "Résidence meublé" } },
      "Résidence meublé, deux chambre salon à cédé à Abidjan Oui précisément au quartier abbata");
    expect(e.est_immobilier).toBe(true);
    expect(e.hors_gabon).toBe(true);
  });

  it("marque hors Gabon sur signalement justifié du modèle", () => {
    const src = "Villa à louer à Dakar au Sénégal, 3 chambres";
    const e = sanitizeExtraction({ ...good, hors_gabon: true, extraits: { immobilier: "Villa à louer", hors_gabon: "Dakar au Sénégal" } }, src);
    expect(e.hors_gabon).toBe(true);
  });

  it("ne prend pas un quartier de Libreville pour une ville étrangère", () => {
    for (const src of ["Chambre à louer à Lalala à Dakar, 60k", "Studio à Petit Paris", "Maison à Plaine Niger", "Appartement à London"]) {
      expect(sanitizeExtraction({ ...good, extraits: { immobilier: src.split(",")[0] } }, src).hors_gabon).toBe(false);
    }
    // Signalement du modèle sans extrait présent dans le texte : ignoré.
    expect(sanitizeExtraction({ ...good, hors_gabon: true, extraits: { ...good.extraits, hors_gabon: "Abidjan" } }, SOURCE).hors_gabon).toBe(false);
  });

  it("ignore les contacts fournis par l'IA et ne garde que ceux de la source", () => {
    const e = sanitizeExtraction({ ...good, telephone: "066 99 99 99", whatsapp: "+24166999999" }, SOURCE);
    expect(e.telephones).toEqual(["+24177123456"]);
    expect(e.whatsapp).toBeNull();
  });

  it("compare sans tenir compte des accents ni de la casse", () => {
    const e = sanitizeExtraction(
      { ...good, quartier: "Nzeng-Ayong", extraits: { quartier: "nzeng ayong", immobilier: "Chambre" } },
      "Chambre à NZENG-AYONG, prix à débattre"
    );
    expect(e.quartier).toBe("Nzeng-Ayong");
  });

  it("refuse un extrait qui n'est qu'un fragment de mot", () => {
    const e = sanitizeExtraction({ ...good, prix: 15, extraits: { ...good.extraits, prix: "15" } }, SOURCE);
    expect(e.prix).toBeNull();
  });

  it("signale les champs décisifs manquants", () => {
    const e = sanitizeExtraction({ est_immobilier: true, extraits: { immobilier: "Maison disponible" } }, "Maison disponible, me contacter");
    expect(e.transaction).toBe("inconnu");
    expect(e.a_verifier).toEqual(["transaction", "prix", "localisation", "type"]);
  });

  it("tolère une réponse mal formée sans lever d'erreur", () => {
    const e = sanitizeExtraction(
      { est_immobilier: "oui", transaction: "bail", type: 12, prix: "150 000", nb_chambres: "deux", meuble: "yes", caracteristiques: "x", confiance: [], extraits: null },
      SOURCE
    );
    expect(e.est_immobilier).toBe(false);
    expect(e.type).toBeNull();
    expect(e.nb_chambres).toBeNull();
    expect(e.meuble).toBeNull();
    expect(e.prix).toBeNull(); // 150 000 lu, mais sans extrait : rejeté
    expect(sanitizeExtraction(null, SOURCE).est_immobilier).toBe(false);
  });

  it("efface la périodicité pour une vente", () => {
    const e = sanitizeExtraction({ ...good, transaction: "vente", meuble: null }, SOURCE);
    expect(e.periodicite).toBeNull();
  });
});

describe("toTags", () => {
  it("produit des étiquettes normalisées sans doublon", () => {
    const e = sanitizeExtraction({ ...good, caracteristiques: ["Parking", "gardien"] }, SOURCE);
    expect(toTags(e)).toEqual(["meublé", "climatisé", "parking", "gardien"]);
  });
});
