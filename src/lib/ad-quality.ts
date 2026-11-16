import { extractContacts } from "./contacts";
import { locatePlace } from "./geo";

// Contrôle qualité des annonces relues par RapidAPI (facebook-scraper3).
// Module pur : aucun appel réseau. Il dit si une publication est une annonce, puis si elle est
// complète (texte entier, photos, prix, quartier, contact, description).

/** Publication renvoyée par facebook-scraper3 (/group/posts, /post). Tous les champs sont facultatifs. */
export interface ScraperPost {
  post_id?: string | number | null;
  type?: string | null;
  url?: string | null;
  timestamp?: number | null;
  message?: string | null;
  message_rich?: string | null;
  image?: unknown;
  album_preview?: unknown[] | null;
  images_count?: number | null;
  video?: unknown;
  video_thumbnail?: unknown;
  external_url?: string | null;
  attached_post?: { message?: string | null; photo_url?: string | null; album_url?: string | null } | null;
  attached_post_url?: string | null;
  author?: { id?: string | null; name?: string | null } | null;
  [key: string]: unknown;
}

export const ISSUE_CODES = [
  "TRUNCATED",
  "NO_PHOTO",
  "FEW_PHOTOS",
  "MISSING_PRICE",
  "MISSING_LOCATION",
  "MISSING_CONTACT",
  "WEAK_CONTACT",
  "MISSING_DESCRIPTION",
  "MISSING_ROOMS",
  "MISSING_SURFACE",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

/** Libellés affichés aux agents. */
export const ISSUE_LABELS: Record<IssueCode, string> = {
  TRUNCATED: "Texte tronqué",
  NO_PHOTO: "Aucune photo",
  FEW_PHOTOS: "Peu de photos",
  MISSING_PRICE: "Prix manquant",
  MISSING_LOCATION: "Quartier manquant",
  MISSING_CONTACT: "Contact manquant",
  WEAK_CONTACT: "Contact par message privé uniquement",
  MISSING_DESCRIPTION: "Description trop courte",
  MISSING_ROOMS: "Nombre de pièces manquant",
  MISSING_SURFACE: "Surface manquante",
};

export type RequiredField = "PRICE" | "LOCATION" | "CONTACT" | "DESCRIPTION" | "ROOMS" | "SURFACE";
export type QualityStatus = "OK" | "INCOMPLETE" | "REJECTED" | "NOT_AD";

export interface GroupCheckConfig {
  requiredFields: RequiredField[];
  minPhotos: number;
  minCompleteLength: number;
  minDescriptionLength: number;
  /** Lieux reconnus en plus du répertoire des quartiers et villes du Gabon. */
  extraPlaces: string[];
  /** Tournures d'une demande ou d'une discussion : la publication n'est pas une annonce. */
  notAdPatterns: RegExp[];
}

export interface Extracted {
  price: number | null;
  currency: string | null;
  location: string | null;
  phones: string[];
  photoCount: number;
  textLength: number;
}

export interface AnalysisResult {
  post_id: string;
  url: string | null;
  status: QualityStatus;
  issues: IssueCode[];
  labels: string[];
  score: number;
  extracted: Extracted;
}

export const DEFAULT_CHECK_CONFIG: GroupCheckConfig = {
  requiredFields: ["PRICE", "LOCATION", "CONTACT", "DESCRIPTION"],
  minPhotos: 3,
  minCompleteLength: 80,
  minDescriptionLength: 60,
  extraPlaces: [],
  notAdPatterns: [
    /\bje\s+(cherche|recherche)\b/i,
    /\bnous\s+(cherchons|recherchons)\b/i,
    /\b(qui\s+a|quelqu'un\s+(a|aurait|conna[iî]t))\b/i,
    /\bbesoin\s+d'?une?\s+(maison|appart|studio|chambre|terrain|logement)/i,
    /^\s*(recherche|cherche)\s/i,
  ],
};

const PENALTY: Record<IssueCode, number> = {
  TRUNCATED: 30,
  NO_PHOTO: 30,
  FEW_PHOTOS: 10,
  MISSING_PRICE: 15,
  MISSING_LOCATION: 15,
  MISSING_CONTACT: 15,
  WEAK_CONTACT: 0,
  MISSING_DESCRIPTION: 20,
  MISSING_ROOMS: 15,
  MISSING_SURFACE: 15,
};
/** Avertissements : signalés, mais ne rendent pas l'annonce incomplète à eux seuls. */
const WARNINGS: IssueCode[] = ["FEW_PHOTOS", "WEAK_CONTACT"];

const TRUNCATION_END = /(…|\.\.\.|see more|voir plus|afficher la suite)$/i;
const MONEY =
  /(\d{1,3}(?:[\s., ]\d{3})+|\d+(?:[.,]\d+)?)\s*(millions?|m|k)?\s*(fcfa|f\s?cfa|cfa|xaf|frs?|f|€|eur|euros?|\$)(?![a-z])/i;
const SHORT_MONEY = /\b(\d+(?:[.,]\d+)?)\s*(k|m|millions?)(?![a-z²2])/i;
const PRICE_WORD = /\b(prix|loyer|montant)\b|[àa]\s+d[ée]battre/i;
const PRIVATE_MESSAGE = /\b(mp|inbox|dm)\b|message\s+priv[ée]|en\s+priv[ée]/i;
const WHATSAPP_WORD = /whats\s?app|wa\.me/i;
const LOCATION_WORD = /situ[ée]e?\s+[àa]|\bquartier\b|[àa]\s+c[ôo]t[ée]\s+de|derri[èe]re|non\s+loin|carrefour|\bpk\s?\d+/i;
const ROOMS = /\b\d+\s*(chambres?|ch\b|pi[èe]ces?|salons?)|\b(studio|f\d|t\d)\b/i;
const SURFACE = /\b\d+(?:[.,]\d+)?\s*(m2|m²|mètres?\s+carr[ée]s|ha|hectares?)(?![a-z])/i;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** Texte d'une publication : le message, ou celui du post partagé quand c'est un partage. */
export function postText(post: ScraperPost): string {
  const own = typeof post.message === "string" ? post.message : "";
  if (own.trim()) return own;
  const shared = post.attached_post?.message;
  return typeof shared === "string" ? shared : "";
}

/** Nombre de photos (ou vidéo) de la publication. */
export function photoCount(post: ScraperPost): number {
  const album = Array.isArray(post.album_preview) ? post.album_preview.length : 0;
  const counted = typeof post.images_count === "number" ? post.images_count : 0;
  const single = post.image ? 1 : 0;
  const video = post.video || post.video_thumbnail ? 1 : 0;
  const shared = post.attached_post?.photo_url || post.attached_post?.album_url ? 1 : 0;
  return Math.max(counted, album, single, video, shared);
}

/**
 * Prix écrit dans le texte, en francs CFA sauf devise contraire.
 *
 * @example extractPrice("Loyer 150 000 FCFA") // { price: 150000, currency: "XAF", mentioned: true }
 * @example extractPrice("Prix : 2,5M")        // { price: 2500000, currency: "XAF", mentioned: true }
 */
export function extractPrice(text: string): { price: number | null; currency: string | null; mentioned: boolean } {
  const match = text.match(MONEY) ?? text.match(SHORT_MONEY);
  if (match) {
    const unit = (match[2] || "").toLowerCase();
    const raw = match[1].replace(/[\s ]/g, "");
    // « 150.000 » : séparateur de milliers ; « 2,5 » : décimale.
    const value = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, "")) : Number(raw.replace(",", "."));
    const factor = unit.startsWith("m") ? 1_000_000 : unit === "k" ? 1_000 : 1;
    const symbol = (match[3] || "").toLowerCase();
    const currency = symbol.includes("€") || symbol.startsWith("eur") ? "EUR" : symbol === "$" ? "USD" : "XAF";
    const price = Number.isFinite(value) && value > 0 ? Math.round(value * factor) : null;
    return { price, currency: price ? currency : null, mentioned: true };
  }
  return { price: null, currency: null, mentioned: PRICE_WORD.test(text) };
}

/** Quartier ou ville reconnu dans le texte (répertoire du Gabon + lieux ajoutés). */
export function extractLocation(text: string, extraPlaces: string[] = []): string | null {
  const place = locatePlace(text);
  if (place) return place.lieu;
  const lower = text.toLowerCase();
  const extra = extraPlaces.find((p) => p && lower.includes(p.toLowerCase()));
  if (extra) return extra;
  return LOCATION_WORD.test(text) ? "mentionné" : null;
}

/** Longueur de la description une fois retirés émojis, mots-dièse, prix et numéros. */
export function descriptionLength(text: string): number {
  return text
    .replace(EMOJI, "")
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(new RegExp(MONEY.source, "gi"), "")
    .replace(/(\+?\d[\d\s.-]{6,}\d)/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** Le texte semble-t-il coupé par Facebook ou par le flux ? */
export function isTruncated(post: ScraperPost, config: GroupCheckConfig = DEFAULT_CHECK_CONFIG): boolean {
  const text = postText(post).trim();
  if (!text) return false;
  if (TRUNCATION_END.test(text)) return true;
  const rich = typeof post.message_rich === "string" ? post.message_rich.trim() : "";
  if (rich && typeof post.message === "string" && rich.length > post.message.trim().length + 20) return true;
  // Court et sans ponctuation finale : la suite a probablement été repliée.
  return text.length < config.minCompleteLength && /[\p{L}\p{N},]$/u.test(text);
}

/** Annonce ou simple discussion (demande, question, partage sans texte) ? */
export function classifyPost(post: ScraperPost, config: GroupCheckConfig = DEFAULT_CHECK_CONFIG): "AD" | "NOT_AD" {
  const text = postText(post).trim();
  if (!text) return photoCount(post) > 0 ? "AD" : "NOT_AD";
  if (config.notAdPatterns.some((p) => p.test(text))) return "NOT_AD";
  // Une question courte sans prix ni contact est une discussion.
  if (/\?\s*$/.test(text) && text.length < 200 && !extractPrice(text).mentioned && !extractContacts(text).phones.length) return "NOT_AD";
  return "AD";
}

/**
 * Verdict qualité d'une publication : statut, problèmes (codes + libellés), note sur 100, champs lus.
 *
 * @example
 * const r = analysePost(post)
 * // { status: "INCOMPLETE", issues: ["MISSING_PRICE"], labels: ["Prix manquant"], score: 85, … }
 */
export function analysePost(post: ScraperPost, config: GroupCheckConfig = DEFAULT_CHECK_CONFIG): AnalysisResult {
  const text = postText(post);
  const photos = photoCount(post);
  const price = extractPrice(text);
  const contacts = extractContacts(text);
  const extracted: Extracted = {
    price: price.price,
    currency: price.currency,
    location: extractLocation(text, config.extraPlaces),
    phones: contacts.phones,
    photoCount: photos,
    textLength: text.trim().length,
  };
  const base = { post_id: String(post.post_id ?? ""), url: typeof post.url === "string" ? post.url : null, extracted };

  if (classifyPost(post, config) === "NOT_AD") return { ...base, status: "NOT_AD", issues: [], labels: [], score: 0 };

  const issues: IssueCode[] = [];
  if (isTruncated(post, config)) issues.push("TRUNCATED");
  if (photos === 0) issues.push("NO_PHOTO");
  else if (photos < config.minPhotos) issues.push("FEW_PHOTOS");

  const required = new Set(config.requiredFields);
  if (required.has("PRICE") && !price.mentioned) issues.push("MISSING_PRICE");
  if (required.has("LOCATION") && !extracted.location) issues.push("MISSING_LOCATION");
  if (required.has("CONTACT") && !contacts.phones.length && !WHATSAPP_WORD.test(text)) {
    issues.push(PRIVATE_MESSAGE.test(text) ? "WEAK_CONTACT" : "MISSING_CONTACT");
  }
  if (required.has("DESCRIPTION") && descriptionLength(text) < config.minDescriptionLength) issues.push("MISSING_DESCRIPTION");
  if (required.has("ROOMS") && !ROOMS.test(text)) issues.push("MISSING_ROOMS");
  if (required.has("SURFACE") && !SURFACE.test(text)) issues.push("MISSING_SURFACE");

  const score = Math.max(0, 100 - issues.reduce((sum, code) => sum + PENALTY[code], 0));
  const blocking = issues.filter((code) => !WARNINGS.includes(code));
  const status: QualityStatus =
    score < 40 || (issues.includes("TRUNCATED") && issues.includes("NO_PHOTO"))
      ? "REJECTED"
      : blocking.length || score < 80
        ? "INCOMPLETE"
        : "OK";
  return { ...base, status, issues, labels: issues.map((code) => ISSUE_LABELS[code]), score };
}

/** Champs d'une annonce collectée par flux, pour juger s'il vaut la peine de la relire. */
export interface AnnonceForSuspicion {
  raw_text: string | null;
  prix: number | null;
  quartier: string | null;
  telephone: string | null;
  whatsapp: string | null;
}

/**
 * Note de doute d'une annonce collectée par flux : plus elle est haute, plus la relecture
 * RapidAPI a de chances d'apporter le texte complet, le prix ou le contact.
 * WHY: le flux ne garde qu'une photo et coupe certains textes sans « … » ; un texte court
 * sans prix ni contact est le signe le plus fiable.
 *
 * @example suspicionScore({ raw_text: "Studio à louer", prix: null, quartier: null, telephone: null, whatsapp: null }) // 8
 */
export function suspicionScore(a: AnnonceForSuspicion): number {
  const len = (a.raw_text || "").trim().length;
  let score = 0;
  if (len < 120) score += 3;
  else if (len < 220) score += 1;
  if (!a.prix) score += 2;
  if (!a.telephone && !a.whatsapp) score += 2;
  if (!a.quartier) score += 1;
  return score;
}

/** À partir de cette note, une annonce est jugée douteuse et proposée à la relecture. */
export const SUSPICION_THRESHOLD = 3;
