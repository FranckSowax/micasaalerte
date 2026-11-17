import { describe, expect, it } from "vitest";
import { cardDescription, cardMeta, cardPhotoLabel, cardPlace, cardPrice, cardTitle, otherDoubts, primaryAction, publishedLabel } from "./client-card";

// Carte d'annonce de l'espace abonné : textes construits à partir des vraies données, sans rien inventer.

const maison = {
  typeOffre: "location",
  typeBien: "maison",
  chambres: 3,
  meuble: false,
  quartier: "Angondjé",
  ville: "Akanda",
  resume: "Belle maison familiale avec cour, proche de la route.",
  prix: null,
  devise: null,
  doubts: ["Prix non indiqué"],
  whatsapp: null,
  telephone: "24106000000",
  publishedAt: "2026-11-17T10:18:00Z",
};

describe("carte d'annonce de l'espace abonné", () => {
  it("construit le titre à partir du type et des chambres", () => {
    expect(cardTitle(maison)).toBe("Maison 3 chambres");
    expect(cardTitle({ typeBien: "studio", chambres: 1 })).toBe("Studio 1 chambre");
    expect(cardTitle({ typeBien: null, chambres: null })).toBe("Logement");
  });

  it("donne les métadonnées présentes seulement", () => {
    expect(cardMeta(maison)).toEqual(["Location", "Maison"]);
    expect(cardMeta({ typeOffre: null, typeBien: "appartement", meuble: true })).toEqual(["Appartement", "Meublé"]);
  });

  it("écrit le lieu, ou « Lieu non précisé »", () => {
    expect(cardPlace(maison)).toBe("Angondjé, Akanda · 3 ch.");
    expect(cardPlace({ quartier: null, ville: null, chambres: null })).toBe("Lieu non précisé");
    expect(cardPhotoLabel(maison)).toBe("Maison à Angondjé, Akanda");
  });

  it("n'affiche pas une description qui répète le titre", () => {
    expect(cardDescription(maison)).toBe(maison.resume);
    expect(cardDescription({ ...maison, resume: "maison 3 chambres." })).toBeNull();
    expect(cardDescription({ ...maison, resume: "  " })).toBeNull();
  });

  it("ne mentionne le prix manquant qu'une fois", () => {
    expect(cardPrice(maison)).toBeNull();
    expect(otherDoubts(maison)).toEqual([]);
    expect(otherDoubts({ doubts: ["Prix non indiqué", "Quartier non précisé"] })).toEqual(["Quartier non précisé"]);
    expect(cardPrice({ prix: 250000, devise: null })).toMatch(/^250\s000 FCFA$/);
  });

  it("date la publication à l'heure du Gabon", () => {
    expect(publishedLabel(maison.publishedAt)).toBe("Publiée le 17 nov. 2026 · 11:18");
    expect(publishedLabel(null)).toBeNull();
    expect(publishedLabel("pas une date")).toBeNull();
  });

  describe("action principale", () => {
    const cases: [string, Parameters<typeof primaryAction>[0], boolean, ReturnType<typeof primaryAction>][] = [
      ["WhatsApp, prix connu", { whatsapp: "241", telephone: "241", prix: 1 }, false, { kind: "whatsapp", label: "Demander une visite" }],
      ["WhatsApp, prix absent", { whatsapp: "241", telephone: null, prix: null }, false, { kind: "whatsapp", label: "Demander le prix sur WhatsApp" }],
      ["téléphone seul, prix connu", { whatsapp: null, telephone: "241", prix: 1 }, false, { kind: "call", label: "Appeler l'annonceur" }],
      ["téléphone seul, prix absent", { whatsapp: null, telephone: "241", prix: null }, false, { kind: "call", label: "Appeler pour confirmer le prix" }],
      ["aucun contact", { whatsapp: null, telephone: null, prix: 1 }, false, { kind: "source", label: "Contacter via l'annonce" }],
      ["déjà contacté sur WhatsApp", { whatsapp: "241", telephone: null, prix: null }, true, { kind: "whatsapp", label: "Relancer sur WhatsApp" }],
    ];
    it.each(cases)("%s", (_name, annonce, contacted, expected) => {
      expect(primaryAction(annonce, contacted)).toEqual(expected);
    });
  });
});
