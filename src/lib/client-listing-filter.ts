// Tri et filtres des annonces reçues dans l'espace abonné (/c/[token]), sous la carte.
// Fonctions pures : la page applique les filtres à la carte et à la liste, le tri à la liste.

export const LISTING_SORTS = ["recent", "price_asc", "price_desc", "rooms_desc"] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

export const LISTING_SORT_LABELS: Record<ListingSort, string> = {
  recent: "Plus récentes",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
  rooms_desc: "Plus de chambres",
};

export interface ListingFilters {
  withPhotos: boolean;
  furnished: boolean;
  /** Types de bien retenus ; vide = tous. */
  types: string[];
}

export const NO_FILTERS: ListingFilters = { withPhotos: false, furnished: false, types: [] };

/** Champs utiles au tri et aux filtres. */
export interface FilterableAnnonce {
  prix: number | null;
  chambres: number | null;
  meuble: boolean | null;
  typeBien: string | null;
  image: string | null;
  images?: string[];
  publishedAt: string | null;
  sentAt: string | null;
}

function time(a: FilterableAnnonce): number {
  const t = new Date(a.publishedAt || a.sentAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Valeur absente ou nulle : toujours en fin de liste, quel que soit le sens du tri. */
function byNumber(a: number | null, b: number | null, ascending: boolean): number {
  const x = a || null;
  const y = b || null;
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  return ascending ? x - y : y - x;
}

/**
 * Trie sans modifier la liste d'origine. À égalité, la plus récente d'abord.
 *
 * @example sortListings(annonces, "price_asc") // prix croissant, sans prix à la fin
 */
export function sortListings<T extends FilterableAnnonce>(list: T[], sort: ListingSort): T[] {
  const recent = (a: T, b: T) => time(b) - time(a);
  const compare: Record<ListingSort, (a: T, b: T) => number> = {
    recent,
    price_asc: (a, b) => byNumber(a.prix, b.prix, true) || recent(a, b),
    price_desc: (a, b) => byNumber(a.prix, b.prix, false) || recent(a, b),
    rooms_desc: (a, b) => byNumber(a.chambres, b.chambres, false) || recent(a, b),
  };
  return [...list].sort(compare[sort]);
}

/** L'annonce a-t-elle au moins une photo ? */
export function hasPhoto(a: FilterableAnnonce): boolean {
  return !!(a.images?.length || a.image);
}

/** Annonces qui passent les filtres. */
export function filterListings<T extends FilterableAnnonce>(list: T[], f: ListingFilters): T[] {
  return list.filter(
    (a) =>
      (!f.withPhotos || hasPhoto(a)) &&
      (!f.furnished || a.meuble === true) &&
      (!f.types.length || (!!a.typeBien && f.types.includes(a.typeBien))),
  );
}

/** Nombre de filtres actifs (pour le bouton « Effacer »). */
export function activeFilterCount(f: ListingFilters): number {
  return Number(f.withPhotos) + Number(f.furnished) + f.types.length;
}

/** Types de bien présents dans la liste, du plus fréquent au moins fréquent. */
export function availableTypes(list: FilterableAnnonce[]): string[] {
  const counts: Record<string, number> = {};
  for (const a of list) if (a.typeBien) counts[a.typeBien] = (counts[a.typeBien] || 0) + 1;
  return Object.keys(counts).sort((x, y) => counts[y] - counts[x] || x.localeCompare(y));
}
