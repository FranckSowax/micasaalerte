import { formatPrice, getTypeBienLabel, getTypeOffreLabel } from "@/lib/utils";

// Textes de la carte d'annonce de l'espace abonné (/c/[token]) : titre, métadonnées, lieu, date et
// action principale. Fonctions pures, testées à part : la page ne fait que les afficher.

/** Champs de l'annonce dont la carte a besoin (sous-ensemble de l'annonce de l'espace client). */
export interface CardAnnonce {
  typeOffre: string | null;
  typeBien: string | null;
  chambres: number | null;
  meuble: boolean | null;
  quartier: string | null;
  ville: string | null;
  resume: string | null;
  prix: number | null;
  devise: string | null;
  doubts?: string[];
  whatsapp: string | null;
  telephone: string | null;
  publishedAt: string | null;
}

/** Action principale de la carte. « source » : ouvrir l'annonce d'origine (aucun contact direct). */
export interface PrimaryAction {
  kind: "whatsapp" | "call" | "source";
  label: string;
}

// WHY: heure du Gabon quel que soit le fuseau du téléphone ou du serveur de rendu.
const TIME_ZONE = "Africa/Libreville";
const PRICE_DOUBT = /prix/i;

/**
 * Titre construit à partir des données (l'annonce n'a pas de champ titre). Rien n'est inventé.
 * @example cardTitle({ typeBien: "maison", chambres: 3, ... }) // « Maison 3 chambres »
 */
export function cardTitle(a: Pick<CardAnnonce, "typeBien" | "chambres">): string {
  const type = a.typeBien ? getTypeBienLabel(a.typeBien) : "Logement";
  if (!a.chambres) return type;
  return `${type} ${a.chambres} chambre${a.chambres > 1 ? "s" : ""}`;
}

/**
 * Métadonnées affichées en capitales au-dessus du titre (transaction, type, meublé).
 * @example cardMeta({ typeOffre: "location", typeBien: "maison", meuble: true }) // ["Location", "Maison", "Meublé"]
 */
export function cardMeta(a: Pick<CardAnnonce, "typeOffre" | "typeBien" | "meuble">): string[] {
  return [
    a.typeOffre ? getTypeOffreLabel(a.typeOffre) : null,
    a.typeBien ? getTypeBienLabel(a.typeBien) : null,
    a.meuble ? "Meublé" : null,
  ].filter((v): v is string => !!v);
}

/**
 * Lieu et nombre de chambres, sur une ligne.
 * @example cardPlace({ quartier: "Angondjé", ville: "Akanda", chambres: 3 }) // « Angondjé, Akanda · 3 ch. »
 */
export function cardPlace(a: Pick<CardAnnonce, "quartier" | "ville" | "chambres">): string {
  const place = [a.quartier, a.ville].filter(Boolean).join(", ") || "Lieu non précisé";
  return a.chambres ? `${place} · ${a.chambres} ch.` : place;
}

/** Texte alternatif des photos : « Maison à Angondjé, Akanda ». */
export function cardPhotoLabel(a: Pick<CardAnnonce, "typeBien" | "quartier" | "ville">): string {
  const type = a.typeBien ? getTypeBienLabel(a.typeBien) : "Logement";
  const place = [a.quartier, a.ville].filter(Boolean).join(", ");
  return place ? `${type} à ${place}` : type;
}

/** Normalise un texte pour comparer (casse, accents, ponctuation). */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Description à afficher, ou null si elle est vide ou ne fait que répéter le titre. */
export function cardDescription(a: Pick<CardAnnonce, "resume" | "typeBien" | "chambres">): string | null {
  const resume = a.resume?.trim();
  if (!resume) return null;
  return normalize(resume) === normalize(cardTitle(a)) ? null : resume;
}

/** Prix formaté, ou null quand l'annonceur ne l'a pas indiqué. */
export function cardPrice(a: Pick<CardAnnonce, "prix" | "devise">): string | null {
  return a.prix ? formatPrice(a.prix, a.devise || "FCFA") : null;
}

/** Doutes autres que le prix (le prix manquant a déjà son propre bloc « Prix à confirmer »). */
export function otherDoubts(a: Pick<CardAnnonce, "doubts">): string[] {
  return (a.doubts || []).filter((d) => !PRICE_DOUBT.test(d));
}

/**
 * Date de publication : « Publiée le 17 nov. 2026 · 11:18 » (heure du Gabon), ou null.
 * @example publishedLabel("2026-11-17T10:18:00Z") // « Publiée le 17 nov. 2026 · 11:18 »
 */
export function publishedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(date);
  return `Publiée le ${day} · ${time}`;
}

/**
 * Action principale selon les contacts disponibles et le prix.
 * @example primaryAction({ whatsapp: "241…", prix: null, ... }, false) // { kind: "whatsapp", label: "Demander le prix sur WhatsApp" }
 */
export function primaryAction(a: Pick<CardAnnonce, "whatsapp" | "telephone" | "prix">, contacted: boolean): PrimaryAction {
  const priceKnown = !!a.prix;
  if (a.whatsapp) {
    if (contacted) return { kind: "whatsapp", label: "Relancer sur WhatsApp" };
    return { kind: "whatsapp", label: priceKnown ? "Demander une visite" : "Demander le prix sur WhatsApp" };
  }
  if (a.telephone) return { kind: "call", label: priceKnown ? "Appeler l'annonceur" : "Appeler pour confirmer le prix" };
  return { kind: "source", label: "Contacter via l'annonce" };
}
