import { describe, expect, it } from "vitest";
import { distanceKm, gazetteerSize, locateAnnonce, locatePlace } from "./geo";

describe("référentiel", () => {
  it("contient les quartiers de Libreville et les villes du Gabon", () => {
    const size = gazetteerSize();
    expect(size.quartier).toBeGreaterThan(90);
    expect(size.ville).toBeGreaterThan(40);
  });
});

describe("locatePlace", () => {
  it.each([
    ["Angondjé", "Angondjé"],
    ["ANGONDJE", "Angondjé"],
    ["angondje entraco", "Angondjé"],
    ["Nzeng-Ayong", "Nzeng Ayong"],
    ["nzeng ayong au carrefour gp", "Nzeng Ayong"],
    ["Mindoube2", "Mindoubé 2"],
    ["Alibadeng", "Alibandeng"], // faute de frappe
    ["Montagne sainte", "Montagne Sainte"],
    ["Okala", "Okala"],
    ["OKALA MIKOLOGO", "Okala"],
    ["Lalala à Dakar", "Lalala-Dakar"],
    ["Charbonnage", "Charbonnages"],
    ["Bikele", "Bikélé"],
    ["Essassa", "Essassa"],
  ])("reconnaît « %s »", (input, expected) => {
    expect(locatePlace(input)?.lieu).toBe(expected);
  });

  it("préfère le quartier à la ville quand le texte cite les deux", () => {
    expect(locatePlace("Angondjé, Akanda")).toMatchObject({ lieu: "Angondjé", precision: "quartier" });
  });

  it("reconnaît une ville, avec une précision « ville »", () => {
    expect(locatePlace("Port-Gentil")).toMatchObject({ lieu: "Port-Gentil", precision: "ville" });
    expect(locatePlace("Franceville", ["ville"])?.precision).toBe("ville");
  });

  it.each(["derrière le marché", "abbata", "", "zz", "au bord du goudron"])("ne devine pas un lieu pour « %s »", (input) => {
    expect(locatePlace(input)).toBeNull();
  });

  it("ne reconnaît pas un nom courant court au milieu d'une phrase", () => {
    // « Louis » et « Glass » sont des quartiers, mais aussi des mots ordinaires.
    expect(locatePlace("chez Louis le gardien")).toBeNull();
    expect(locatePlace("Louis")?.lieu).toBe("Louis"); // seul, c'est bien le quartier
  });
});

describe("distanceKm", () => {
  it("mesure des distances cohérentes autour de Libreville", () => {
    const angondje = locatePlace("Angondjé")!;
    const okala = locatePlace("Okala")!;
    const owendo = locatePlace("Owendo", ["ville"])!;
    expect(distanceKm(angondje, angondje)).toBe(0);
    expect(distanceKm(angondje, okala)).toBeGreaterThan(1);
    expect(distanceKm(angondje, okala)).toBeLessThan(8);
    expect(distanceKm(angondje, owendo)).toBeGreaterThan(15);
  });
});

describe("locateAnnonce", () => {
  it("utilise les coordonnées enregistrées quand elles existent", () => {
    const point = locateAnnonce({ quartier: "Okala", details: { geo: { lat: 0.5, lon: 9.4, lieu: "Angondjé", precision: "quartier" } } });
    expect(point).toMatchObject({ lat: 0.5, lon: 9.4, lieu: "Angondjé" });
  });

  it("retrouve le lieu à la volée pour une annonce ancienne", () => {
    expect(locateAnnonce({ quartier: "angondje premiere cite", ville: null })?.precision).toBe("quartier");
    expect(locateAnnonce({ quartier: null, adresse_complete: "après la mosquée, Nzeng-Ayong", ville: null })?.lieu).toBe("Nzeng Ayong");
  });

  it("retombe sur la ville quand le quartier est inconnu", () => {
    expect(locateAnnonce({ quartier: "abbata", ville: "Libreville" })).toMatchObject({ lieu: "Libreville", precision: "ville" });
  });

  it("renvoie null quand rien n'est reconnu", () => {
    expect(locateAnnonce({ quartier: null, ville: null })).toBeNull();
  });
});
