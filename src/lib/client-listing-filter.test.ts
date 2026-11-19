import { describe, expect, it } from "vitest";
import { activeFilterCount, availableTypes, filterListings, NO_FILTERS, sortListings, type FilterableAnnonce } from "./client-listing-filter";

const base: FilterableAnnonce = { prix: null, chambres: null, meuble: null, typeBien: null, image: null, publishedAt: null, sentAt: null };
const a = (id: string, o: Partial<FilterableAnnonce>) => ({ id, ...base, ...o });

const list = [
  a("cher", { prix: 500_000, chambres: 3, typeBien: "maison", publishedAt: "2026-11-15T10:00:00Z", image: "x.jpg", meuble: true }),
  a("sans-prix", { publishedAt: "2026-11-17T10:00:00Z", typeBien: "studio" }),
  a("bon-marche", { prix: 120_000, chambres: 1, typeBien: "studio", publishedAt: "2026-11-16T10:00:00Z", images: ["y.jpg"] }),
];
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe("tri des annonces reçues", () => {
  it("trie par date de publication, la plus récente d'abord", () => {
    expect(ids(sortListings(list, "recent"))).toEqual(["sans-prix", "bon-marche", "cher"]);
  });

  it("met les annonces sans prix à la fin dans les deux sens", () => {
    expect(ids(sortListings(list, "price_asc"))).toEqual(["bon-marche", "cher", "sans-prix"]);
    expect(ids(sortListings(list, "price_desc"))).toEqual(["cher", "bon-marche", "sans-prix"]);
  });

  it("trie par nombre de chambres", () => {
    expect(ids(sortListings(list, "rooms_desc"))).toEqual(["cher", "bon-marche", "sans-prix"]);
  });

  it("ne modifie pas la liste d'origine", () => {
    sortListings(list, "price_asc");
    expect(ids(list)).toEqual(["cher", "sans-prix", "bon-marche"]);
  });
});

describe("filtres des annonces reçues", () => {
  it("garde les annonces avec photo et meublées", () => {
    expect(ids(filterListings(list, { ...NO_FILTERS, withPhotos: true }))).toEqual(["cher", "bon-marche"]);
    expect(ids(filterListings(list, { ...NO_FILTERS, furnished: true }))).toEqual(["cher"]);
  });

  it("filtre par type de bien et compte les filtres actifs", () => {
    const f = { ...NO_FILTERS, types: ["studio"], withPhotos: true };
    expect(ids(filterListings(list, f))).toEqual(["bon-marche"]);
    expect(activeFilterCount(f)).toBe(2);
  });

  it("liste les types présents, du plus fréquent au moins fréquent", () => {
    expect(availableTypes(list)).toEqual(["studio", "maison"]);
  });
});
