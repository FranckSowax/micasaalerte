import { describe, expect, it } from "vitest";
import type { Annonce, ClientDemand } from "@/types/database";
import { isQuietHour, localHour, matchDemand, shouldSend, shouldSendForCheck, startOfLocalDayIso } from "./matching";

function annonce(overrides: Record<string, unknown> = {}): Annonce {
  return {
    id: "a1",
    type_offre: "location",
    type_bien: "appartement",
    prix: 250000,
    nb_chambres: 2,
    superficie: null,
    meuble: null,
    quartier: "Okala",
    ville: "Libreville",
    raw_text: "Bel appartement calme",
    ai_summary: "",
    ai_tags: [],
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
    filter_type_bien: ["appartement", "studio"],
    filter_prix_min: null,
    filter_prix_max: 300000,
    filter_nb_chambres_min: 2,
    filter_quartiers: [],
    filter_ville: "Libreville",
    filter_meuble: null,
    exigences: null,
    source: "form",
    last_message_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("critères bloquants", () => {
  it("accepte une annonce conforme, score 100 sans préférence souple", () => {
    const m = matchDemand(annonce(), demand());
    expect(m).toMatchObject({ eligible: true, needsReview: false, score: 100, blockedBy: [] });
    expect(shouldSend(m, demand())).toBe(true);
  });

  it("retient pour vérification une annonce presque vide, même sans critère contredit", () => {
    // Cas réel : vente d'articles classée immobilière, client « vente » sans autre critère.
    const d = demand({ filter_type_offre: ["vente"], filter_type_bien: [], filter_prix_max: null, filter_nb_chambres_min: null });
    const vide = annonce({ type_offre: "vente", type_bien: null, prix: null, quartier: null, nb_chambres: null });
    const m = matchDemand(vide, d);
    expect(m.needsReview).toBe(true);
    expect(m.uncertain).toContain("contenu");
    expect(shouldSend(m, d)).toBe(false);

    const complete = annonce({ type_offre: "vente", type_bien: "maison", prix: 70000000, quartier: null, nb_chambres: 4 });
    expect(matchDemand(complete, d).uncertain).not.toContain("contenu");
  });

  it("une seule information manquante part chez l'abonné pour vérification, pas plus", () => {
    const d = demand();
    // Prix absent seulement : l'abonné peut le demander à l'annonceur.
    const sansPrix = matchDemand(annonce({ prix: null }), d);
    expect(sansPrix.clientCanCheck).toBe(true);
    expect(shouldSendForCheck(sansPrix, d)).toBe(true);
    expect(shouldSend(sansPrix, d)).toBe(false);

    // Prix et transaction absents : deux manques, l'annonce reste chez l'agent.
    const deuxManques = matchDemand(annonce({ prix: null, type_offre: null }), d);
    expect(deuxManques.needsReview).toBe(true);
    expect(shouldSendForCheck(deuxManques, d)).toBe(false);

    // Annonce presque vide : jamais envoyée d'office.
    const vide = matchDemand(annonce({ type_bien: null, prix: null, quartier: null, nb_chambres: null }), demand({ filter_prix_max: null, filter_nb_chambres_min: null }));
    expect(shouldSendForCheck(vide, d)).toBe(false);

    // Annonce complète : envoi normal, rien à vérifier.
    expect(matchDemand(annonce(), d).clientCanCheck).toBe(false);
  });

  it("équipements souhaités : une annonce qui n'en parle pas reste envoyée", () => {
    const d = demand({ exigences: "Gardien, Forage" });
    const m = matchDemand(annonce(), d);
    expect(m.eligible).toBe(true);
    expect(shouldSend(m, d)).toBe(true);
    const avec = matchDemand(annonce({ raw_text: "Appartement avec gardien et forage" }), d);
    expect(avec.score).toBeGreaterThanOrEqual(m.score);
  });

  it("équipements indispensables : l'annonce doit les mentionner tous", () => {
    const d = demand({ exigences: "Gardien, Parking (indispensables)" });
    expect(matchDemand(annonce(), d).blockedBy).toContain("equipement");
    expect(matchDemand(annonce({ raw_text: "Appartement avec gardien" }), d).blockedBy).toContain("equipement");
    const complet = annonce({ raw_text: "Appartement avec gardien", details: { parking: true } });
    expect(matchDemand(complet, d).blockedBy).not.toContain("equipement");
  });

  it("accepte un bureau pour un client qui cherche un commerce, pas l'inverse", () => {
    const commerce = demand({ filter_type_bien: ["commerce"], filter_nb_chambres_min: null });
    expect(matchDemand(annonce({ type_bien: "bureau", nb_chambres: null }), commerce).blockedBy).not.toContain("type");
    expect(matchDemand(annonce({ type_bien: "commerce", nb_chambres: null }), commerce).blockedBy).not.toContain("type");
    expect(matchDemand(annonce({ type_bien: "bureau" }), demand()).blockedBy).toContain("type");
  });

  it.each([
    ["transaction", { type_offre: "vente" }],
    ["type", { type_bien: "terrain" }],
    ["budget_max", { prix: 350000 }],
    ["chambres", { nb_chambres: 1 }],
    ["ville", { ville: "Port-Gentil" }],
  ])("écarte sur %s", (reason, overrides) => {
    const m = matchDemand(annonce(overrides), demand());
    expect(m.eligible).toBe(false);
    expect(m.blockedBy).toEqual([reason]);
    expect(shouldSend(m, demand())).toBe(false);
  });

  it("écarte sous le budget minimal", () => {
    expect(matchDemand(annonce({ prix: 50000 }), demand({ filter_prix_min: 100000 })).blockedBy).toEqual(["budget_min"]);
  });

  it("compare la ville sans tenir compte des accents ni de la casse", () => {
    expect(matchDemand(annonce({ ville: "LIBREVILLE" }), demand()).eligible).toBe(true);
  });
});

describe("annonce incomplète", () => {
  it("n'écarte pas une annonce sans surface ni meublé renseignés", () => {
    const m = matchDemand(annonce(), demand({ filter_surface_min: 80, filter_meuble: true }));
    expect(m.eligible).toBe(true);
    expect(m.score).toBe(50); // préférences inconnues = demi-valeur
    expect(shouldSend(m, demand({ filter_surface_min: 80, filter_meuble: true }))).toBe(true);
  });

  it("retient pour vérification quand le prix est inconnu", () => {
    const m = matchDemand(annonce({ prix: null }), demand());
    expect(m).toMatchObject({ eligible: true, needsReview: true });
    expect(m.uncertain).toContain("prix");
    expect(shouldSend(m, demand())).toBe(false);
  });

  it("ne demande pas de vérification du prix si l'abonné n'a pas de budget", () => {
    const d = demand({ filter_prix_max: null });
    expect(matchDemand(annonce({ prix: null }), d).needsReview).toBe(false);
  });

  it("accepte une ville inconnue quand le quartier est connu", () => {
    expect(matchDemand(annonce({ ville: null }), demand())).toMatchObject({ eligible: true, needsReview: false });
  });

  it("retient pour vérification sans ville ni quartier", () => {
    const m = matchDemand(annonce({ ville: null, quartier: null }), demand());
    expect(m.needsReview).toBe(true);
    expect(m.uncertain).toContain("ville");
  });

  it("type de bien obligatoire : un type inconnu n'est jamais envoyé comme une annonce sûre", () => {
    const d = demand();
    const m = matchDemand(annonce({ type_bien: null, nb_chambres: null }), d);
    expect(m).toMatchObject({ eligible: true, needsReview: true, score: 80 });
    expect(m.decisiveDoubts).toEqual(["type"]);
    expect(shouldSend(m, d)).toBe(false);
    // Seul le type manque : l'abonné la reçoit dans « À vérifier ».
    expect(shouldSendForCheck(m, d)).toBe(true);
  });

  it("nombre de chambres inconnu seul : simple pénalité, l'annonce part normalement", () => {
    const d = demand({ filter_nb_chambres_min: 2 });
    const m = matchDemand(annonce({ nb_chambres: null }), d);
    expect(m).toMatchObject({ eligible: true, needsReview: false });
    expect(shouldSend(m, d)).toBe(true);
  });
});

describe("score des préférences", () => {
  it("donne 100 au quartier préféré et 0 à un autre", () => {
    const d = demand({ filter_quartiers: ["Okala", "Angondjé"] });
    expect(matchDemand(annonce(), d).score).toBe(100);
    const other = matchDemand(annonce({ quartier: "Owendo" }), d);
    expect(other.score).toBe(0);
    // Secteur obligatoire : un autre quartier écarte l'annonce.
    expect(other.eligible).toBe(false);
    expect(other.blockedBy).toContain("secteur");
    expect(shouldSend(other, d)).toBe(false);
  });

  it("pondère plusieurs préférences", () => {
    const d = demand({ filter_quartiers: ["Okala"], filter_meuble: true, filter_parking: true });
    // quartier 35/35 + meublé 0/15 + parking (étiquette) 10/10 = 45/60
    const m = matchDemand(annonce({ meuble: false, ai_tags: ["parking"] }), d);
    expect(m.score).toBe(75);
  });

  it("lit les préférences dans le texte libre « exigences »", () => {
    const d = demand({ exigences: "Meublé, climatisé" });
    const m = matchDemand(annonce({ meuble: true, details: { climatise: false } }), d);
    expect(m.score).toBe(60); // meublé 15/15 + climatisation 0/10
  });

  it("applique les mots-clés favoris et exclus", () => {
    const d = demand({ keywords_include: ["calme", "piscine"], keywords_exclude: ["colocation"] });
    expect(matchDemand(annonce(), d).score).toBe(50);
    expect(matchDemand(annonce({ raw_text: "Appartement calme en colocation" }), d).score).toBe(20);
  });

  it("respecte le seuil propre à l'abonné", () => {
    const d = demand({ filter_quartiers: ["Okala"], filter_meuble: true, min_score: 80 });
    const m = matchDemand(annonce({ meuble: false }), d); // 35/50 = 70
    expect(m.score).toBe(70);
    expect(shouldSend(m, d)).toBe(false);
    expect(shouldSend(m, { ...d, min_score: 60 })).toBe(true);
  });
});

describe("matching par rayon", () => {
  const cherche = (overrides: Partial<ClientDemand> = {}) => demand({ filter_quartiers: ["Angondjé"], filter_ville: "", ...overrides });

  it("retient un quartier voisin au nom différent, dans le rayon par défaut (5 km)", () => {
    // Okala est à 4,7 km du centre d'Angondjé ; par le nom seul, il aurait été écarté.
    const m = matchDemand(annonce({ quartier: "Okala", ville: null }), cherche());
    expect(m.score).toBe(100);
    expect(m.reasons.join(" ")).toMatch(/km de Angondjé/);
  });

  it("reconnaît le même endroit écrit autrement", () => {
    expect(matchDemand(annonce({ quartier: "angondje premiere cite", ville: null }), cherche()).score).toBe(100);
    expect(matchDemand(annonce({ quartier: "Première Cité", ville: null }), cherche()).score).toBe(100);
  });

  it("écarte un quartier éloigné", () => {
    // Nzeng Ayong est à 13,6 km d'Angondjé.
    const m = matchDemand(annonce({ quartier: "Nzeng-Ayong", ville: null }), cherche());
    expect(m.score).toBe(0);
    // Secteur obligatoire : hors du rayon, l'annonce est écartée.
    expect(m.eligible).toBe(false);
    expect(m.blockedBy).toContain("secteur");
    expect(shouldSend(m, cherche())).toBe(false);
  });

  it("respecte le rayon propre à l'abonné", () => {
    const okala = annonce({ quartier: "Okala", ville: null });
    expect(matchDemand(okala, cherche({ geo_radius_km: 2 })).score).toBe(0);
    expect(matchDemand(annonce({ quartier: "Alibandeng", ville: null }), cherche({ geo_radius_km: 10 })).score).toBe(100);
  });

  it("utilise le point précis de l'abonné quand il est renseigné", () => {
    // Point situé à Nzeng Ayong, alors que le quartier préféré écrit est Angondjé.
    const d = cherche({ geo_lat: 0.4271, geo_lon: 9.4822, geo_radius_km: 4 });
    expect(matchDemand(annonce({ quartier: "Sotega", ville: null }), d).score).toBe(100);
    expect(matchDemand(annonce({ quartier: "Okala", ville: null }), d).score).toBe(0);
  });

  it("utilise les coordonnées enregistrées avec l'annonce", () => {
    const stored = annonce({ quartier: "lieu inconnu du référentiel", ville: null, details: { geo: { lat: 0.5288, lon: 9.4144, lieu: "Angondjé", precision: "quartier" } } });
    expect(matchDemand(stored, cherche()).score).toBe(100);
  });

  it("retombe sur la comparaison des noms quand l'annonce n'est pas localisable", () => {
    expect(matchDemand(annonce({ quartier: "cité inconnue", ville: null }), cherche()).score).toBe(0);
    // Aucun quartier dans l'annonce : ni confirmé ni exclu, à vérifier par l'abonné.
    const sansLieu = matchDemand(annonce({ quartier: null, ville: null }), cherche());
    expect(sansLieu.score).toBe(50);
    expect(sansLieu.eligible).toBe(true);
    expect(sansLieu.decisiveDoubts).toEqual(["secteur"]);
    expect(shouldSendForCheck(sansLieu, cherche())).toBe(true);
    // Quartier préféré absent du référentiel : comparaison par nom, comme avant.
    const d = cherche({ filter_quartiers: ["Cité Magnolia"] });
    expect(matchDemand(annonce({ quartier: "cité magnolia", ville: null }), d).score).toBe(100);
  });

  it("ne traite pas une ville comme un point précis", () => {
    // « Owendo » est une commune entière : pas de calcul de distance, comparaison par nom.
    expect(matchDemand(annonce({ quartier: "Owendo", ville: null }), cherche()).score).toBe(0);
  });
});

describe("plage silencieuse et journée locale (Africa/Libreville, UTC+1)", () => {
  it("convertit l'heure UTC en heure locale", () => {
    expect(localHour(new Date("2026-11-14T23:30:00Z"))).toBe(0);
    expect(localHour(new Date("2026-11-14T05:00:00Z"))).toBe(6);
  });

  it("gère une plage qui passe minuit", () => {
    expect(isQuietHour(new Date("2026-11-14T20:30:00Z"), 21, 7)).toBe(true); // 21h30 locale
    expect(isQuietHour(new Date("2026-11-14T05:59:00Z"), 21, 7)).toBe(true); // 6h59
    expect(isQuietHour(new Date("2026-11-14T06:00:00Z"), 21, 7)).toBe(false); // 7h00
    expect(isQuietHour(new Date("2026-11-14T12:00:00Z"), 21, 7)).toBe(false);
  });

  it("gère une plage dans la même journée et une plage désactivée", () => {
    expect(isQuietHour(new Date("2026-11-14T12:00:00Z"), 12, 14)).toBe(true); // 13h
    expect(isQuietHour(new Date("2026-11-14T12:00:00Z"), 8, 8)).toBe(false);
  });

  it("calcule le début de la journée locale", () => {
    expect(startOfLocalDayIso(new Date("2026-11-14T12:00:00Z"))).toBe("2026-11-13T23:00:00.000Z");
    expect(startOfLocalDayIso(new Date("2026-11-14T23:30:00Z"))).toBe("2026-11-14T23:00:00.000Z");
  });
});
