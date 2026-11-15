// Mise en forme des marqueurs de la carte : prix court, couleur par transaction, regroupement.

/** Couleurs des marqueurs selon la transaction. */
export const TRANSACTION_COLORS: Record<string, string> = {
  location: "#15803d",
  vente: "#c2410c",
  colocation: "#0e7490",
};
/** Plusieurs transactions au même endroit, ou transaction inconnue. */
export const MIXED_COLOR = "#334155";
/** Zones de recherche des clients. */
export const ZONE_COLOR = "#2563eb";

/**
 * Prix court pour l'étiquette d'un marqueur.
 *
 * @example shortPrice(250000) // "250k" ; shortPrice(1500000) // "1,5M"
 */
export function shortPrice(prix: number | null | undefined): string {
  if (!prix || !Number.isFinite(prix) || prix <= 0) return "";
  if (prix >= 1_000_000) {
    const m = Math.round(prix / 100_000) / 10;
    return `${String(m).replace(".", ",")}M`;
  }
  if (prix >= 1_000) return `${Math.round(prix / 1_000)}k`;
  return String(Math.round(prix));
}

/**
 * Couleur d'un groupe d'annonces : celle de la transaction si toutes partagent la même, sinon neutre.
 *
 * @example transactionColor(["location", "location"]) // vert
 */
export function transactionColor(types: (string | null | undefined)[]): string {
  const set = new Set(types.map((t) => t || ""));
  if (set.size !== 1) return MIXED_COLOR;
  return TRANSACTION_COLORS[Array.from(set)[0]] || MIXED_COLOR;
}

/**
 * Regroupe les points trop proches à l'écran (en pixels) : chaque groupe est une liste d'indices.
 * WHY: les annonces sont localisées au quartier ; vues de loin, les pastilles de quartiers voisins
 * se recouvrent. Regroupement glouton, suffisant pour quelques centaines de points.
 *
 * @example clusterByDistance([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 200, y: 0 }], 40) // [[0, 1], [2]]
 */
export function clusterByDistance(points: { x: number; y: number }[], radiusPx: number): number[][] {
  const groups: { x: number; y: number; members: number[] }[] = [];
  points.forEach((p, i) => {
    const near = groups.find((g) => Math.hypot(g.x - p.x, g.y - p.y) <= radiusPx);
    if (near) near.members.push(i);
    else groups.push({ x: p.x, y: p.y, members: [i] });
  });
  return groups.map((g) => g.members);
}

/** Lien d'image utilisable dans une infobulle : HTTPS uniquement. */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
