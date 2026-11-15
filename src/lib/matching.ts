import type { Annonce, ClientDemand } from "@/types/database";
import { normalizeText } from "./extraction";
import { DEFAULT_RADIUS_KM, distanceKm, locateAnnonce, locatePlace, type GeoPoint } from "./geo";

// Matching abonné ↔ annonce, entièrement déterministe : l'IA n'intervient pas ici.
//  1. critères bloquants : une contradiction écarte l'annonce ;
//  2. score 0-100 sur les préférences ;
//  3. envoi si le score atteint le seuil, sauf doute sur un champ décisif (à vérifier).
// Une annonce incomplète n'est pas rejetée : un champ inconnu n'est jamais une contradiction.

export const DEFAULT_MIN_SCORE = 50;
/** Annonces ajoutées par jour à l'espace d'un abonné (les alertes sont un lien, pas une rafale de messages). */
export const DEFAULT_MAX_ALERTS_PER_DAY = 100;
export const DEFAULT_QUIET_START = 21;
export const DEFAULT_QUIET_END = 7;
export const ALERT_TIMEZONE = "Africa/Libreville";

/** Valeur attribuée à une préférence quand l'annonce ne dit rien sur ce point. */
const UNKNOWN = 0.5;
const WEIGHTS = { quartier: 35, meuble: 15, climatise: 10, parking: 10, surface: 10, motsCles: 20, equipement: 5 } as const;

/**
 * Équipements cochés dans le formulaire et repérés dans le texte de l'annonce (pas de champ dédié).
 * `key` : libellé de l'option, normalisé ; `words` : formulations rencontrées dans les annonces.
 */
const TEXT_EQUIPMENTS: { key: string; label: string; words: string[] }[] = [
  { key: "gardien", label: "gardien", words: ["gardien", "gardiennage", "vigile"] },
  { key: "eau chaude", label: "eau chaude", words: ["eau chaude", "chauffe eau"] },
  { key: "groupe electrogene", label: "groupe électrogène", words: ["groupe electrogene", "groupe electro"] },
  { key: "forage", label: "forage", words: ["forage"] },
  { key: "barriere", label: "barrière", words: ["barriere", "cloture", "portail"] },
  { key: "douche interne", label: "douche interne", words: ["douche interne", "douche interieure", "toilette interne", "toilettes internes", "wc interne"] },
  { key: "cuisine equipee", label: "cuisine équipée", words: ["cuisine equipee", "cuisine amenagee"] },
  { key: "bord de route", label: "bord de route", words: ["bord de route", "bordure de route", "en bordure"] },
];
const EXCLUDED_KEYWORD_PENALTY = 30;
const UNCERTAIN_PENALTY = 10;

export interface MatchResult {
  /** Aucun critère bloquant n'est contredit. */
  eligible: boolean;
  /** Critères bloquants contredits (annonce écartée). */
  blockedBy: string[];
  /** Critères bloquants impossibles à vérifier faute d'information dans l'annonce. */
  uncertain: string[];
  /** Doute sur le prix, la ville ou la transaction : à valider par un humain avant envoi. */
  needsReview: boolean;
  score: number;
  /** Ce qui a pesé dans le score, pour l'explication. */
  reasons: string[];
}

interface DetailsLike {
  climatise?: boolean | null;
  parking?: boolean | null;
}

function detailsOf(annonce: Annonce): DetailsLike {
  const d = (annonce as unknown as { details?: unknown }).details;
  return d && typeof d === "object" ? (d as DetailsLike) : {};
}

function hasTag(annonce: Annonce, needle: string): boolean {
  return (annonce.ai_tags || []).some((t) => normalizeText(t).includes(needle));
}

/**
 * Points autour desquels l'abonné cherche : son adresse précise si elle est renseignée
 * (geo_lat / geo_lon), sinon le centre de chacun de ses quartiers préférés.
 */
function demandCenters(demand: ClientDemand): GeoPoint[] {
  if (typeof demand.geo_lat === "number" && typeof demand.geo_lon === "number") {
    return [{ lat: demand.geo_lat, lon: demand.geo_lon, lieu: "adresse souhaitée", precision: "quartier" }];
  }
  const centers: GeoPoint[] = [];
  for (const name of demand.filter_quartiers || []) {
    const point = locatePlace(name, ["quartier", "localite"]);
    if (point) centers.push(point);
  }
  return centers;
}

/** Préférences souples de l'abonné : colonnes dédiées, complétées par le texte libre « exigences ». */
export function demandPreferences(demand: ClientDemand) {
  const exigences = normalizeText(demand.exigences || "");
  const wants = (column: boolean | null | undefined, word: string): boolean | null =>
    typeof column === "boolean" ? column : exigences.includes(word) ? true : null;

  return {
    quartiers: (demand.filter_quartiers || []).map(normalizeText).filter(Boolean),
    centers: demandCenters(demand),
    radiusKm: demand.geo_radius_km && demand.geo_radius_km > 0 ? Number(demand.geo_radius_km) : DEFAULT_RADIUS_KM,
    meuble: wants(demand.filter_meuble, "meubl"),
    climatise: wants(demand.filter_climatise, "climatis"),
    parking: wants(demand.filter_parking, "parking"),
    // « (indispensables) » dans les exigences : l'annonce doit mentionner chaque équipement coché.
    // Sinon ce sont des préférences : elles pèsent dans le score sans écarter l'annonce.
    strict: exigences.includes("indispensable"),
    equipments: TEXT_EQUIPMENTS.filter((e) => exigences.includes(e.key)),
    surfaceMin: demand.filter_surface_min ?? null,
    keywordsInclude: (demand.keywords_include || []).map(normalizeText).filter(Boolean),
    keywordsExclude: (demand.keywords_exclude || []).map(normalizeText).filter(Boolean),
    minScore: demand.min_score ?? DEFAULT_MIN_SCORE,
  };
}

function boolScore(wanted: boolean, actual: boolean | null | undefined): number {
  if (actual === null || actual === undefined) return UNKNOWN;
  return actual === wanted ? 1 : 0;
}

/**
 * Compare une annonce aux critères d'un abonné.
 *
 * @example
 * const m = matchDemand(annonce, demand);
 * if (shouldSend(m, demand)) envoyer(annonce);
 */
export function matchDemand(annonce: Annonce, demand: ClientDemand): MatchResult {
  const blockedBy: string[] = [];
  const uncertain: string[] = [];
  const reasons: string[] = [];
  const prefs = demandPreferences(demand);

  // ---------- 1. Critères bloquants ----------
  if (demand.filter_type_offre?.length) {
    if (!annonce.type_offre) uncertain.push("transaction");
    else if (!demand.filter_type_offre.includes(annonce.type_offre)) blockedBy.push("transaction");
  }

  if (demand.filter_type_bien?.length) {
    if (!annonce.type_bien) uncertain.push("type");
    // Un client qui cherche un commerce accepte aussi un bureau (local professionnel).
    else if (
      !demand.filter_type_bien.includes(annonce.type_bien) &&
      !(annonce.type_bien === "bureau" && demand.filter_type_bien.includes("commerce"))
    ) {
      blockedBy.push("type");
    }
  }

  if (demand.filter_prix_min || demand.filter_prix_max) {
    if (!annonce.prix) uncertain.push("prix");
    else if (demand.filter_prix_min && annonce.prix < demand.filter_prix_min) blockedBy.push("budget_min");
    else if (demand.filter_prix_max && annonce.prix > demand.filter_prix_max) blockedBy.push("budget_max");
  }

  if (demand.filter_nb_chambres_min) {
    if (annonce.nb_chambres === null || annonce.nb_chambres === undefined) uncertain.push("chambres");
    else if (annonce.nb_chambres < demand.filter_nb_chambres_min) blockedBy.push("chambres");
  }

  if (demand.filter_ville) {
    if (annonce.ville) {
      if (normalizeText(annonce.ville) !== normalizeText(demand.filter_ville)) blockedBy.push("ville");
    } else if (!annonce.quartier) {
      // Ni ville ni quartier : impossible de situer le bien.
      uncertain.push("ville");
    }
  }

  const details = detailsOf(annonce);
  const text = ` ${normalizeText(`${annonce.raw_text || ""} ${annonce.ai_summary || ""} ${(annonce.ai_tags || []).join(" ")}`)} `;
  const actualClimatise = details.climatise ?? (hasTag(annonce, "climatis") ? true : null);
  const actualParking = details.parking ?? (hasTag(annonce, "parking") ? true : null);
  const mentions = (words: string[]) => words.some((w) => text.includes(w));

  // Équipements indispensables : l'annonce doit les mentionner tous. Une annonce qui n'en dit
  // rien est écartée — c'est le choix explicite de l'abonné, annoncé comme plus restrictif.
  if (prefs.strict) {
    const missing: string[] = [];
    if (prefs.meuble === true && annonce.meuble !== true) missing.push("meublé");
    if (prefs.climatise === true && actualClimatise !== true) missing.push("climatisé");
    if (prefs.parking === true && actualParking !== true) missing.push("parking");
    for (const e of prefs.equipments) if (!mentions(e.words)) missing.push(e.label);
    if (missing.length) {
      blockedBy.push("equipement");
      reasons.push(`équipements indispensables absents : ${missing.join(", ")}`);
    }
  }

  // Annonce presque vide : moins de deux informations parmi type de bien, prix et quartier.
  // WHY: elle ne contredit aucun critère, donc elle passerait chez tous les clients (cas d'une
  // vente d'articles prise pour de l'immobilier). Un humain la relit avant tout envoi.
  const known = [annonce.type_bien, annonce.prix, annonce.quartier].filter(Boolean).length;
  if (known < 2) uncertain.push("contenu");

  // ---------- 2. Score des préférences ----------
  let weightSum = 0;
  let earned = 0;
  const add = (weight: number, value: number, label: string) => {
    weightSum += weight;
    earned += weight * value;
    reasons.push(`${label} : ${value === 1 ? "oui" : value === 0 ? "non" : "inconnu"}`);
  };

  if (prefs.quartiers.length || prefs.centers.length) {
    const quartier = annonce.quartier ? normalizeText(annonce.quartier) : "";
    const sameName = !!quartier && prefs.quartiers.some((q) => quartier.includes(q) || q.includes(quartier));

    // WHY: un même endroit porte plusieurs noms. Quand l'annonce et la recherche sont
    // localisées, on compare une distance plutôt que des noms ; sinon on retombe sur le nom.
    const point = locateAnnonce(annonce as unknown as Parameters<typeof locateAnnonce>[0]);
    const located = point && point.precision !== "ville" ? point : null;
    let nearest: { km: number; lieu: string } | null = null;
    if (located) {
      for (const center of prefs.centers) {
        const km = distanceKm(located, center);
        if (!nearest || km < nearest.km) nearest = { km, lieu: center.lieu };
      }
    }

    if (nearest) {
      const inside = nearest.km <= prefs.radiusKm || sameName;
      weightSum += WEIGHTS.quartier;
      earned += inside ? WEIGHTS.quartier : 0;
      reasons.push(`à ${nearest.km.toFixed(1)} km de ${nearest.lieu} (rayon ${prefs.radiusKm} km) : ${inside ? "oui" : "non"}`);
    } else {
      const value = !quartier ? UNKNOWN : sameName ? 1 : 0;
      add(WEIGHTS.quartier, value, "quartier préféré");
    }
  }
  if (prefs.meuble !== null) add(WEIGHTS.meuble, boolScore(prefs.meuble, annonce.meuble), "meublé");

  if (prefs.climatise !== null) add(WEIGHTS.climatise, boolScore(prefs.climatise, actualClimatise), "climatisation");
  if (prefs.parking !== null) add(WEIGHTS.parking, boolScore(prefs.parking, actualParking), "parking");
  // Équipements repérés dans le texte : mentionné = oui ; non mentionné = inconnu, jamais « non ».
  for (const e of prefs.equipments) add(WEIGHTS.equipement, mentions(e.words) ? 1 : UNKNOWN, e.label);
  if (prefs.surfaceMin) {
    const value = !annonce.superficie ? UNKNOWN : annonce.superficie >= prefs.surfaceMin ? 1 : 0;
    add(WEIGHTS.surface, value, "surface");
  }

  if (prefs.keywordsInclude.length) {
    const found = prefs.keywordsInclude.filter((k) => text.includes(` ${k} `)).length;
    weightSum += WEIGHTS.motsCles;
    earned += WEIGHTS.motsCles * (found / prefs.keywordsInclude.length);
    reasons.push(`mots-clés favoris : ${found}/${prefs.keywordsInclude.length}`);
  }

  let score = weightSum > 0 ? (100 * earned) / weightSum : 100;

  const excluded = prefs.keywordsExclude.filter((k) => text.includes(` ${k} `));
  if (excluded.length) {
    score -= EXCLUDED_KEYWORD_PENALTY * excluded.length;
    reasons.push(`mots-clés exclus présents : ${excluded.join(", ")}`);
  }
  // Type ou nombre de chambres inconnus : l'annonce reste éligible, mais passe après les autres.
  score -= UNCERTAIN_PENALTY * uncertain.filter((u) => u === "type" || u === "chambres").length;

  const needsReview = uncertain.some((u) => u === "prix" || u === "ville" || u === "transaction" || u === "contenu");

  return {
    eligible: blockedBy.length === 0,
    blockedBy,
    uncertain,
    needsReview,
    score: Math.round(Math.min(100, Math.max(0, score))),
    reasons,
  };
}

/** Décision d'envoi automatique : éligible, pas de doute décisif, score au-dessus du seuil. */
export function shouldSend(match: MatchResult, demand: ClientDemand): boolean {
  return match.eligible && !match.needsReview && match.score >= demandPreferences(demand).minScore;
}

/** Heure locale (0-23) dans le fuseau des alertes. */
export function localHour(date: Date, timeZone = ALERT_TIMEZONE): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date));
}

/**
 * Plage silencieuse, bornes en heures locales ; gère le passage de minuit (21 → 7).
 * @example isQuietHour(new Date(), 21, 7)
 */
export function isQuietHour(date: Date, start = DEFAULT_QUIET_START, end = DEFAULT_QUIET_END): boolean {
  if (start === end) return false;
  const hour = localHour(date);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Début de la journée locale en cours, en ISO UTC : borne du plafond d'alertes quotidien. */
export function startOfLocalDayIso(date: Date, timeZone = ALERT_TIMEZONE): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  // Décalage du fuseau à cet instant, déduit de l'écart entre l'heure locale et l'heure UTC.
  const diff = (localHour(date, timeZone) - date.getUTCHours() + 24) % 24;
  const offset = diff > 12 ? diff - 24 : diff;
  return new Date(Date.parse(`${day}T00:00:00Z`) - offset * 3_600_000).toISOString();
}
