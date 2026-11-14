import { normalizePhone } from "./contacts";
import { normalizeText } from "./extraction";

// Détection des annonces en double, par règles (sans IA).
// Une même offre circule souvent plusieurs fois : republiée par son auteur, relayée
// dans plusieurs groupes, reprise par un autre diffuseur sur Facebook ou TikTok.
//  1. texte quasi identique  → même annonce, quel que soit le diffuseur ;
//  2. même fiche (transaction, type, prix, quartier) + téléphone commun ou texte proche
//     → même annonce ;
//  3. texte quasi identique mais prix différent → mise à jour de prix de l'annonce.

/** Au-dessus de ce seuil, deux textes décrivent la même annonce. */
export const TEXT_DUPLICATE_THRESHOLD = 0.7;
/** Seuil plus bas, suffisant quand la fiche (transaction, type, prix, quartier) est identique. */
export const TEXT_SUPPORT_THRESHOLD = 0.4;
/** On ne compare qu'aux annonces de cette fenêtre : au-delà, une republication redevient une annonce. */
export const DEDUPE_WINDOW_DAYS = 30;
/** En dessous, un texte est trop court pour être comparé de façon fiable. */
const MIN_WORDS = 6;
const SHINGLE_SIZE = 3;

const PHONE_LIKE = /(?:\+|00)?\d(?:[ .\-]?\d){7,}/g;
const MONEY = /(\d(?:[ .,]?\d)*)\s?(?:k|mil|mille|millions?|m|f|fcfa|cfa|frs?|xaf)\b/gi;
const NUMBER = /\d(?:[ .]?\d)*/g;

export interface Fingerprint {
  /** Groupes de 3 mots consécutifs du texte normalisé, hors numéros de téléphone. */
  shingles: Set<string>;
  /** Montants et grands nombres du texte (prix, caution…), triés : repère les changements de prix. */
  numbers: string[];
  words: number;
}

/**
 * Empreinte d'un texte d'annonce, insensible à la casse, aux accents, aux emojis,
 * à la ponctuation et aux coordonnées du diffuseur.
 *
 * @example similarity(fingerprint(texteA), fingerprint(texteB)) >= TEXT_DUPLICATE_THRESHOLD
 */
export function fingerprint(text: string): Fingerprint {
  const numbers = new Set<string>();
  for (const m of Array.from(text.matchAll(MONEY))) numbers.add(m[1].replace(/\D/g, ""));
  for (const m of Array.from(text.matchAll(NUMBER))) {
    const digits = m[0].replace(/\D/g, "");
    // Les numéros de téléphone ne sont pas des montants, et changent d'un diffuseur à l'autre.
    if (digits.length >= 4 && digits.length <= 10 && !normalizePhone(m[0])) numbers.add(digits);
  }

  const words = normalizeText(text.replace(PHONE_LIKE, " ")).split(" ").filter(Boolean);
  const shingles = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= words.length; i++) shingles.add(words.slice(i, i + SHINGLE_SIZE).join(" "));

  return { shingles, numbers: Array.from(numbers).sort(), words: words.length };
}

/** Proportion de groupes de mots communs (indice de Jaccard), entre 0 et 1. */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  if (a.words < MIN_WORDS || b.words < MIN_WORDS) return 0;
  const [small, large] = a.shingles.size <= b.shingles.size ? [a.shingles, b.shingles] : [b.shingles, a.shingles];
  let common = 0;
  for (const s of Array.from(small)) if (large.has(s)) common++;
  const union = a.shingles.size + b.shingles.size - common;
  return union ? common / union : 0;
}

export function sameNumbers(a: Fingerprint, b: Fingerprint): boolean {
  return a.numbers.length === b.numbers.length && a.numbers.every((n, i) => n === b.numbers[i]);
}

/** Ce qu'il faut connaître d'une annonce pour la comparer. */
export interface ListingKey {
  type_offre: string | null;
  type_bien: string | null;
  prix: number | null;
  quartier: string | null;
  nb_chambres: number | null;
  phones: string[];
}

export interface Candidate extends ListingKey {
  id: string;
  fp: Fingerprint;
}

export type DuplicateKind = "same_text" | "same_listing" | "price_update";

export interface DuplicateMatch {
  candidate: Candidate;
  kind: DuplicateKind;
  score: number;
}

/**
 * Étape 1, avant l'analyse IA : texte quasi identique et mêmes montants.
 * Aucune analyse n'est alors nécessaire, l'annonce existe déjà.
 */
export function findTextDuplicate(fp: Fingerprint, candidates: Candidate[]): DuplicateMatch | null {
  let best: DuplicateMatch | null = null;
  for (const candidate of candidates) {
    const score = similarity(fp, candidate.fp);
    if (score >= TEXT_DUPLICATE_THRESHOLD && sameNumbers(fp, candidate.fp) && (!best || score > best.score)) {
      best = { candidate, kind: "same_text", score };
    }
  }
  return best;
}

function sameField(a: string | null, b: string | null): boolean {
  return !!a && !!b && normalizeText(a) === normalizeText(b);
}

/** Même fiche : transaction, type, prix et quartier identiques (et chambres, si connues des deux côtés). */
function sameSheet(a: ListingKey, b: ListingKey): boolean {
  if (!sameField(a.type_offre, b.type_offre) || !sameField(a.type_bien, b.type_bien)) return false;
  if (!a.prix || !b.prix || a.prix !== b.prix) return false;
  if (!sameField(a.quartier, b.quartier)) return false;
  if (a.nb_chambres !== null && b.nb_chambres !== null && a.nb_chambres !== b.nb_chambres) return false;
  return true;
}

/**
 * Étape 2, après l'analyse IA : compare la fiche et le texte aux annonces récentes.
 *
 * @example
 * const match = findListingDuplicate(fp, fiche, candidates);
 * if (match?.kind === "price_update") mettreAJourLePrix(match.candidate);
 */
export function findListingDuplicate(fp: Fingerprint, key: ListingKey, candidates: Candidate[]): DuplicateMatch | null {
  let best: DuplicateMatch | null = null;
  const consider = (m: DuplicateMatch) => {
    if (!best || m.score > best.score) best = m;
  };

  for (const candidate of candidates) {
    const score = similarity(fp, candidate.fp);
    const sharedPhone = key.phones.some((p) => candidate.phones.includes(p));

    if (score >= TEXT_DUPLICATE_THRESHOLD) {
      // Même texte mais montants différents : le prix a changé, si la fiche le confirme.
      const priceChanged = !!key.prix && !!candidate.prix && key.prix !== candidate.prix;
      consider({ candidate, kind: priceChanged ? "price_update" : "same_text", score });
    } else if (sameSheet(key, candidate) && (sharedPhone || score >= TEXT_SUPPORT_THRESHOLD)) {
      consider({ candidate, kind: "same_listing", score });
    }
  }
  return best;
}
