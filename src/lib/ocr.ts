import { isCopyablePhoto } from "./photos";

// Lecture du texte écrit sur les images d'une publication (OCR).
// WHY: sur TikTok, l'annonce est le plus souvent écrite sur la vidéo ou les photos (« Appartement
// 3 chambres – Okala – 250 000 F – 077… ») ; la légende transmise par le flux se limite alors à
// quelques mots-dièse. Le texte lu sur l'image est ajouté à la légende avant l'analyse, si bien que
// les extraits justifiant chaque champ peuvent provenir de l'un ou de l'autre.

/** Images lues par publication : la couverture et les premières photos d'un carrousel suffisent. */
export const MAX_OCR_IMAGES = 3;
/** Au-delà, une image n'est pas envoyée (coût, délai). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
/** Longueur conservée du texte lu : une annonce, pas un document. */
export const MAX_IMAGE_TEXT = 1500;
/** Intitulé qui sépare la légende du texte lu sur l'image, dans le texte analysé. */
export const IMAGE_TEXT_HEADING = "Texte écrit sur l'image :";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Réponses du modèle signifiant qu'il n'y a rien à lire.
const NOTHING = /^(rien|aucun texte|néant|neant|none|no text|n\/a)\.?$/i;

/**
 * Faut-il lire le texte des images de cette publication ?
 * Seules les publications TikTok sont concernées : sur Facebook, le texte de l'annonce est la publication.
 *
 * @example shouldReadImages({ sourceType: "tiktok", images: [couverture] }) // true
 */
export function shouldReadImages(input: { sourceType: string; images: string[] }): boolean {
  return input.sourceType === "tiktok" && input.images.some(isCopyablePhoto);
}

/** Images à lire : liens autorisés (serveurs des réseaux collectés), sans doublon, dans l'ordre. */
export function pickImages(urls: string[], max = MAX_OCR_IMAGES): string[] {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const url of urls) {
    const key = url.split("?")[0];
    if (!isCopyablePhoto(url) || seen.has(key)) continue;
    seen.add(key);
    picked.push(url);
    if (picked.length >= max) break;
  }
  return picked;
}

/**
 * Nettoie la transcription renvoyée par le modèle : balises markdown, lignes vides répétées,
 * réponse « rien », longueur maximale.
 *
 * @example cleanImageText("```\nVILLA À LOUER\n\n\nOkala\n```") // "VILLA À LOUER\nOkala"
 */
export function cleanImageText(raw: string | null | undefined): string {
  const text = (raw || "")
    .replace(/```[a-z]*\s*/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text || NOTHING.test(text)) return "";
  return text.slice(0, MAX_IMAGE_TEXT);
}

/**
 * Ajoute le texte lu sur l'image à la légende, sous un intitulé, sauf s'il y figure déjà.
 *
 * @example withImageText("#immo #libreville", "Studio meublé 150 000 F Okala")
 */
export function withImageText(text: string, imageText: string | null | undefined): string {
  const extra = (imageText || "").trim();
  const base = text.trim();
  if (!extra || base.includes(extra)) return base;
  return base ? `${base}\n\n${IMAGE_TEXT_HEADING}\n${extra}` : `${IMAGE_TEXT_HEADING}\n${extra}`;
}

/**
 * Texte lu sur l'image, retrouvé dans le texte d'une annonce déjà analysée ("" s'il n'y en a pas).
 *
 * @example imageTextOf(withImageText("#immo", "STUDIO 150 000 F")) // "STUDIO 150 000 F"
 */
export function imageTextOf(rawText: string | null | undefined): string {
  const text = rawText || "";
  const at = text.lastIndexOf(IMAGE_TEXT_HEADING);
  return at < 0 ? "" : text.slice(at + IMAGE_TEXT_HEADING.length).trim();
}

/**
 * Télécharge une image et la renvoie en adresse « data: », pour que le modèle la reçoive sans
 * aller la chercher lui-même (les serveurs TikTok refusent souvent les accès extérieurs).
 * Renvoie null si l'image est inaccessible, trop lourde ou d'un format inattendu.
 */
export async function imageAsDataUrl(url: string): Promise<string | null> {
  if (!isCopyablePhoto(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.includes(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
