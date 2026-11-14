import places from "@/data/gabon-places.json";
import { normalizeText } from "./extraction";

// Localisation des annonces à partir d'un référentiel de lieux du Gabon :
// quartiers et localités de la zone de Libreville, et villes du pays.
// Données © les contributeurs d'OpenStreetMap, sous licence ODbL (voir src/data/gabon-places.json).
//
// WHY: un même endroit s'écrit de dix façons (« Angondjé », « angondje entraco »,
// « Nzeng-Ayong », « nzeng ayong carrefour GP »). On ramène chaque écriture à un lieu
// connu, avec ses coordonnées, pour comparer des distances plutôt que des noms.

export type PlaceKind = "quartier" | "localite" | "ville";

export interface Place {
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  aliases?: string[];
}

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Nom du lieu du référentiel retenu. */
  lieu: string;
  /** Finesse de la localisation : un quartier est exploitable pour un rayon, une ville non. */
  precision: PlaceKind;
}

/**
 * Rayon par défaut autour d'un quartier souhaité, en kilomètres.
 * WHY: 5 km, parce que les centres de quartiers voisins de Libreville sont distants de 3 à 5 km
 * (Angondjé ↔ Première Cité : 3,7 km ; Angondjé ↔ Okala : 4,7 km) et de 8 km ou plus au-delà.
 */
export const DEFAULT_RADIUS_KM = 5;
const EARTH_RADIUS_KM = 6371;
// Un nom long est reconnu n'importe où dans le texte. Un nom court (« Okala », « Louis », « Glass »)
// ne l'est qu'en tête : au milieu d'une phrase, ce peut être un mot ordinaire.
const MIN_ANYWHERE_LENGTH = 6;
const MIN_LEADING_LENGTH = 4;

interface IndexedPlace {
  place: Place;
  keys: string[];
}

const KIND_RANK: Record<PlaceKind, number> = { quartier: 0, localite: 1, ville: 2 };

const INDEX: IndexedPlace[] = (places as Place[]).map((place) => ({
  place,
  keys: Array.from(new Set([place.name, ...(place.aliases || [])].map(normalizeText).filter((k) => k.length >= 2))),
}));

function compact(value: string): string {
  return value.replace(/ /g, "");
}

/** Distance d'édition bornée : tolère une faute de frappe (« Alibadeng » pour « Alibandeng »). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

function toPoint(place: Place): GeoPoint {
  return { lat: place.lat, lon: place.lon, lieu: place.name, precision: place.kind };
}

/**
 * Retrouve le lieu du référentiel désigné par un texte court (quartier ou adresse extraits).
 * Ordre : nom exact, nom à une faute de frappe près, puis nom contenu dans le texte
 * (le plus long l'emporte ; à longueur égale, le quartier passe avant la ville).
 *
 * @example
 * locatePlace("angondje entraco")  // { lieu: "Angondjé", precision: "quartier", … }
 * locatePlace("Mindoube2")         // { lieu: "Mindoubé 2", … }
 * locatePlace("derrière le marché") // null
 */
export function locatePlace(text: string | null | undefined, kinds: PlaceKind[] = ["quartier", "localite", "ville"]): GeoPoint | null {
  const query = normalizeText(text || "");
  if (query.length < 2) return null;
  const queryCompact = compact(query);
  const pool = INDEX.filter((p) => kinds.includes(p.place.kind));

  // 1. Nom exact (espaces et tirets ignorés : « Mindoube2 » = « Mindoubé 2 »).
  let best: { place: Place; rank: number } | null = null;
  for (const { place, keys } of pool) {
    if (keys.some((k) => k === query || compact(k) === queryCompact)) {
      if (!best || KIND_RANK[place.kind] < best.rank) best = { place, rank: KIND_RANK[place.kind] };
    }
  }
  if (best) return toPoint(best.place);

  // 2. Une faute de frappe, sur les noms assez longs pour que ce ne soit pas un hasard.
  let fuzzy: { place: Place; distance: number } | null = null;
  for (const { place, keys } of pool) {
    for (const k of keys) {
      const key = compact(k);
      if (key.length < 7) continue;
      const distance = editDistance(queryCompact, key, key.length >= 11 ? 2 : 1);
      if (distance <= (key.length >= 11 ? 2 : 1) && (!fuzzy || distance < fuzzy.distance)) fuzzy = { place, distance };
    }
  }
  if (fuzzy) return toPoint(fuzzy.place);

  // 3. Nom contenu dans un texte plus long : « nzeng ayong au carrefour GP ».
  const padded = ` ${query} `;
  let contained: { place: Place; length: number } | null = null;
  for (const { place, keys } of pool) {
    for (const k of keys) {
      const found = k.length >= MIN_ANYWHERE_LENGTH ? padded.includes(` ${k} `) : k.length >= MIN_LEADING_LENGTH && padded.startsWith(` ${k} `);
      if (!found) continue;
      const better =
        !contained || k.length > contained.length || (k.length === contained.length && KIND_RANK[place.kind] < KIND_RANK[contained.place.kind]);
      if (better) contained = { place, length: k.length };
    }
  }
  return contained ? toPoint(contained.place) : null;
}

/** Distance à vol d'oiseau entre deux points, en kilomètres (formule de haversine). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface AnnonceLocation {
  quartier?: string | null;
  adresse_complete?: string | null;
  ville?: string | null;
  details?: unknown;
}

/**
 * Coordonnées d'une annonce : celles enregistrées à l'extraction si elles existent,
 * sinon retrouvées à la volée depuis son quartier, son adresse, puis sa ville.
 * Fonctionne donc aussi pour les annonces collectées avant la mise en place de la localisation.
 *
 * @example const point = locateAnnonce(annonce); // null si aucun lieu n'est reconnu
 */
export function locateAnnonce(annonce: AnnonceLocation): GeoPoint | null {
  const stored = (annonce.details as { geo?: Partial<GeoPoint> } | null | undefined)?.geo;
  if (stored && typeof stored.lat === "number" && typeof stored.lon === "number") {
    return { lat: stored.lat, lon: stored.lon, lieu: stored.lieu || "", precision: stored.precision || "quartier" };
  }
  return (
    locatePlace(annonce.quartier, ["quartier", "localite"]) ||
    locatePlace(annonce.adresse_complete, ["quartier", "localite"]) ||
    locatePlace(annonce.quartier, ["ville"]) ||
    locatePlace(annonce.ville, ["ville"])
  );
}

/** Nombre de lieux du référentiel, par type (pour le diagnostic). */
export function gazetteerSize(): Record<PlaceKind, number> {
  const size: Record<PlaceKind, number> = { quartier: 0, localite: 0, ville: 0 };
  for (const { place } of INDEX) size[place.kind]++;
  return size;
}

/** Lieux du référentiel, par ordre alphabétique (pour proposer un choix à l'utilisateur). */
export function listPlaces(kinds: PlaceKind[] = ["quartier", "localite"]): Place[] {
  return INDEX.map((p) => p.place)
    .filter((p) => kinds.includes(p.kind))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/**
 * Quartiers et localités dont le centre se trouve dans un rayon donné, du plus proche au plus éloigné.
 * @example placesWithin({ lat: 0.5288, lon: 9.4144 }, 5).map((p) => p.name) // ["Angondjé", "Première Cité", "Okala", …]
 */
export function placesWithin(
  center: { lat: number; lon: number },
  radiusKm: number,
  kinds: PlaceKind[] = ["quartier", "localite"]
): (Place & { km: number })[] {
  return INDEX.map((p) => ({ ...p.place, km: distanceKm(center, p.place) }))
    .filter((p) => kinds.includes(p.kind) && p.km <= radiusKm)
    .sort((a, b) => a.km - b.km);
}

/** Centre et cadrage par défaut des cartes : l'agglomération de Libreville. */
export const DEFAULT_MAP_CENTER: [number, number] = [0.43, 9.45];
export const DEFAULT_MAP_ZOOM = 12;
