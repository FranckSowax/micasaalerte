import { describe, expect, it } from "vitest";
import { findListingDuplicate, findTextDuplicate, fingerprint, sameNumbers, sameShortText, similarity, type Candidate, type ListingKey } from "./dedupe";

const BASE =
  "🇬🇦🇬🇦.. APPARTEMENT BON STANDING À LOUER ANGONDJÉ APRÈS LA MOSQUÉE DE LA PAIX. 📌 CARACTÉRISTIQUES 🟦2 CHAMBRES AVEC PLACARDS 🟦 SALON 🟦 CUISINE 🟦 DOUCHE 🟦 TERRASSE. Loyer 250 000 FCFA, caution 2 mois. Contact 062 09 08 02";

const key = (overrides: Partial<ListingKey> = {}): ListingKey => ({
  type_offre: "location",
  type_bien: "appartement",
  prix: 250000,
  quartier: "Angondjé",
  nb_chambres: 2,
  phones: ["+24162090802"],
  ...overrides,
});
const candidate = (text: string, overrides: Partial<ListingKey> = {}, id = "a1"): Candidate => ({ id, fp: fingerprint(text), ...key(overrides) });

describe("fingerprint et similarity", () => {
  it("ignore casse, accents, emojis et ponctuation", () => {
    const other = "appartement bon standing a louer angondje apres la mosquee de la paix caracteristiques 2 chambres avec placards salon cuisine douche terrasse loyer 250 000 fcfa caution 2 mois contact 062 09 08 02";
    expect(similarity(fingerprint(BASE), fingerprint(other))).toBe(1);
  });

  it("ignore les coordonnées du diffuseur : même annonce relayée avec un autre numéro", () => {
    const relayed = BASE.replace("062 09 08 02", "077 55 44 33 / 066 11 22 33");
    expect(similarity(fingerprint(BASE), fingerprint(relayed))).toBeGreaterThan(0.9);
    expect(sameNumbers(fingerprint(BASE), fingerprint(relayed))).toBe(true);
  });

  it("repère un changement de prix", () => {
    const cheaper = BASE.replace("250 000 FCFA", "230 000 FCFA");
    expect(sameNumbers(fingerprint(BASE), fingerprint(cheaper))).toBe(false);
    expect(fingerprint("Studio 150k à Okala, caution 300.000").numbers).toEqual(["150", "300000"]);
  });

  it("donne une similarité faible à deux annonces différentes du même agent", () => {
    const other = "🇬🇦🇬🇦.. VILLA MITOYENNE À LOUER À MONTAGNE SAINTE EN BORDURE DE ROUTE 📌 CARACTÉRISTIQUES 🟦4 CHAMBRES AVEC PLACARDS 🟦 SALON 🟦 SALLE À MANGER. Loyer 600 000 FCFA. Contact 062 09 08 02";
    expect(similarity(fingerprint(BASE), fingerprint(other))).toBeLessThan(0.4);
  });

  it("ne compare pas les textes trop courts", () => {
    expect(similarity(fingerprint("Maison à louer"), fingerprint("Maison à louer"))).toBe(0);
  });
});

describe("findTextDuplicate (avant l'IA)", () => {
  it("reconnaît une republication, même par un autre diffuseur avec un préambule", () => {
    const relayed = "Bonjour la famille 🙏 " + BASE.replace("062 09 08 02", "077 55 44 33");
    const match = findTextDuplicate(fingerprint(relayed), [candidate(BASE)]);
    expect(match?.kind).toBe("same_text");
    expect(match?.candidate.id).toBe("a1");
  });

  it("laisse passer à l'IA un texte identique dont le prix a changé", () => {
    expect(findTextDuplicate(fingerprint(BASE.replace("250 000", "230 000")), [candidate(BASE)])).toBeNull();
  });

  it("ne confond pas deux annonces différentes", () => {
    expect(findTextDuplicate(fingerprint("Terrain titré de 500 m2 à vendre à Bikélé, 8 000 000 FCFA à débattre, papiers en règle"), [candidate(BASE)])).toBeNull();
  });

  it("retient le texte le plus proche", () => {
    const close = candidate(BASE + " Disponible immédiatement.", {}, "proche");
    const exact = candidate(BASE, {}, "exact");
    expect(findTextDuplicate(fingerprint(BASE), [close, exact])?.candidate.id).toBe("exact");
  });
});

describe("findListingDuplicate (après l'IA)", () => {
  it("signale une mise à jour de prix quand le texte est le même", () => {
    const fp = fingerprint(BASE.replace("250 000", "230 000"));
    const match = findListingDuplicate(fp, key({ prix: 230000 }), [candidate(BASE)]);
    expect(match?.kind).toBe("price_update");
  });

  it("reconnaît la même fiche réécrite par le même diffuseur (téléphone commun)", () => {
    const rewritten = "Dispo de suite : bel appart 2 chambres à Angondjé vers la mosquée, 250000 le mois. Appelez le 062090802";
    const match = findListingDuplicate(fingerprint(rewritten), key(), [candidate(BASE)]);
    expect(match?.kind).toBe("same_listing");
  });

  it("reconnaît la même fiche chez un autre diffuseur si le texte reste proche", () => {
    const other = "APPARTEMENT BON STANDING À LOUER ANGONDJÉ APRÈS LA MOSQUÉE DE LA PAIX, 2 CHAMBRES AVEC PLACARDS, SALON, CUISINE. 250 000 FCFA. Agence Soleil 077 00 11 22, frais de visite 5000";
    const match = findListingDuplicate(fingerprint(other), key({ phones: ["+24177001122"] }), [candidate(BASE)]);
    expect(match?.kind).toBe("same_listing");
  });

  it("garde distinctes deux offres à la même fiche mais sans téléphone commun ni texte proche", () => {
    const other = "Joli deux chambres salon neuf, carrelé, eau et courant, quartier calme. 250000 FCFA. Tel 077 00 11 22";
    expect(findListingDuplicate(fingerprint(other), key({ phones: ["+24177001122"] }), [candidate(BASE)])).toBeNull();
  });

  it.each([
    ["prix différent", { prix: 300000 }],
    ["quartier différent", { quartier: "Okala" }],
    ["type différent", { type_bien: "studio" }],
    ["transaction différente", { type_offre: "vente" }],
    ["nombre de chambres différent", { nb_chambres: 3 }],
    ["prix inconnu", { prix: null }],
  ])("ne fusionne pas sur la fiche seule : %s", (_label, overrides) => {
    const rewritten = "Bel appart à Angondjé vers la mosquée, dispo de suite. Appelez le 062090802 pour visiter";
    expect(findListingDuplicate(fingerprint(rewritten), key(overrides), [candidate(BASE)])).toBeNull();
  });
});

describe("textes courts tronqués par le flux", () => {
  // Cas réel : le flux ne transmet que la première ligne, republiée par le même diffuseur.
  const court = "APPARTEMENTS À LOUER OKALA 📍";
  const deja = (author: string | null, text = "Appartements à louer Okala"): Candidate => ({ ...candidate(text, {}, "ancien"), author });

  it("fusionne un même texte court republié par le même diffuseur", () => {
    const match = findTextDuplicate(fingerprint(court), [deja("Agence Okala Immo")], "agence okala immo");
    expect(match?.candidate.id).toBe("ancien");
    expect(match?.kind).toBe("same_text");
  });

  it("ne fusionne pas le même texte court publié par un autre diffuseur", () => {
    expect(findTextDuplicate(fingerprint(court), [deja("Agence Okala Immo")], "Autre Agence")).toBeNull();
    expect(findTextDuplicate(fingerprint(court), [deja(null)], null)).toBeNull();
  });

  it("ne fusionne pas deux textes courts différents du même diffuseur", () => {
    expect(findTextDuplicate(fingerprint("Appartements à louer Owendo"), [deja("Agence Okala Immo")], "Agence Okala Immo")).toBeNull();
  });

  it("garde la comparaison par groupes de mots pour les textes longs", () => {
    expect(sameShortText(fingerprint(BASE), "Lewis", { ...candidate(BASE), author: "Lewis" })).toBe(false);
  });
});
