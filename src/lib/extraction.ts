import { z } from "zod";
import { extractContacts } from "./contacts";

// Fiche normalisée d'une annonce : schéma attendu de l'IA, puis contrôle déterministe.
// Règle centrale : une information absente de la source vaut `null`. Tout champ
// important que l'IA ne peut pas justifier par un extrait réellement présent dans
// la source est remis à `null` ici, quel que soit ce qu'elle a répondu.

export const TRANSACTIONS = ["location", "location_meublee", "vente", "colocation", "recherche", "inconnu"] as const;
export const TYPES_BIEN = ["appartement", "maison", "villa", "studio", "chambre", "terrain", "bureau", "commerce"] as const;
export const PERIODICITES = ["jour", "semaine", "mois", "an"] as const;

/** Champs dont la valeur doit être justifiée par un extrait de la source. */
export const CHAMPS_JUSTIFIES = ["prix", "charges", "caution", "ville", "quartier", "adresse"] as const;
type ChampJustifie = (typeof CHAMPS_JUSTIFIES)[number];

export const EXTRACTION_PROMPT = `Tu extrais la fiche d'une annonce immobilière publiée au Gabon (Facebook, TikTok).
Réponds UNIQUEMENT par un objet JSON valide, sans texte autour.

RÈGLE ABSOLUE : si une information n'est pas écrite dans le texte fourni, mets null.
N'invente jamais un prix, un quartier, une ville, une adresse ou un contact, même plausible.
Ne déduis pas la ville d'un quartier. N'utilise aucune connaissance extérieure au texte.

Champs :
- est_immobilier (boolean) : le TEXTE LUI-MÊME propose-t-il ou recherche-t-il un bien immobilier
  (logement, terrain, local) ? false pour une voiture, un emploi, une formation, un vêtement, un
  fonds de commerce sans local, une vidéo ou une publicité sans rapport, même publiée dans un groupe immobilier.
- hors_gabon (boolean) : true seulement si le texte situe explicitement le bien hors du Gabon
  (ex. Abidjan, Douala, Dakar au Sénégal). Attention : Libreville a des quartiers nommés Dakar, London,
  Petit Paris, Plaine Niger, Toulon — ce ne sont pas des lieux étrangers. Dans le doute, false.
- transaction : "location" | "location_meublee" | "vente" | "colocation" | "recherche" | "inconnu"
  ("recherche" = l'auteur CHERCHE un bien à louer ou à acheter, ex. « je cherche un studio »,
  « besoin d'une chambre », « qui a un appartement à louer ? » : ce n'est pas une offre ;
  "inconnu" si ce n'est pas dit)
- type : "appartement" | "maison" | "villa" | "studio" | "chambre" | "terrain" | "bureau" | "commerce" | null
- prix (nombre, "150k" = 150000, "1M" = 1000000) | null
- devise ("XAF" par défaut si un prix est donné) | null
- periodicite du prix : "jour" | "semaine" | "mois" | "an" | null (null pour une vente)
- charges (nombre) | null, caution (nombre, montant total) | null
- pays | null, ville | null, quartier | null, adresse (repère ou adresse approximative) | null
- nb_chambres, nb_salons, nb_salles_bain, nb_pieces, surface_m2 (nombres) | null
- meuble, climatise, parking (boolean) | null si non mentionné
- disponibilite (ex. "immédiate", "1er mars") | null
- description (texte nettoyé, 1 à 3 phrases, sans emojis ni répétitions)
- caracteristiques (liste courte : "gardien", "eau chaude", "titre foncier"…)
- confiance : objet { champ: nombre entre 0 et 1 } pour transaction, type, prix, ville, quartier
- extraits : objet { champ: "passage recopié MOT POUR MOT du texte" } pour chaque champ non nul parmi
  prix, charges, caution, ville, quartier, adresse. Un champ sans extrait exact sera rejeté.
  Ajoute aussi extraits.immobilier : le passage du texte qui montre qu'il s'agit d'un bien immobilier
  (obligatoire si est_immobilier est true), et extraits.hors_gabon si hors_gabon est true.

N'extrais PAS les téléphones ni les e-mails : ils sont relevés séparément.`;

const num = z.preprocess((v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[\s ]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}, z.number().nullable());
const bool = z.preprocess((v) => (typeof v === "boolean" ? v : null), z.boolean().nullable());
const str = z.preprocess((v) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && !/^(null|inconnu|n\/a|non précisé|non spécifié)$/i.test(t) ? t : null;
}, z.string().nullable());
const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && (values as readonly string[]).includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null),
    z.enum(values).nullable()
  );
const record = <T extends z.ZodTypeAny>(value: T) =>
  z.preprocess((v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}), z.record(value));

// WHY: schéma tolérant — un champ mal formé devient null au lieu de faire échouer toute la fiche.
const RawExtractionSchema = z.object({
  est_immobilier: z.preprocess((v) => v === true, z.boolean()),
  hors_gabon: z.preprocess((v) => v === true, z.boolean()),
  transaction: oneOf(TRANSACTIONS),
  type: oneOf(TYPES_BIEN),
  prix: num,
  devise: str,
  periodicite: oneOf(PERIODICITES),
  charges: num,
  caution: num,
  pays: str,
  ville: str,
  quartier: str,
  adresse: str,
  nb_chambres: num,
  nb_salons: num,
  nb_salles_bain: num,
  nb_pieces: num,
  surface_m2: num,
  meuble: bool,
  climatise: bool,
  parking: bool,
  disponibilite: str,
  description: str,
  caracteristiques: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, 12) : []),
    z.array(z.string())
  ),
  confiance: record(num),
  extraits: record(str),
});

export interface Extraction {
  est_immobilier: boolean;
  /** Le texte situe explicitement le bien hors du Gabon : l'annonce est hors périmètre. */
  hors_gabon: boolean;
  transaction: (typeof TRANSACTIONS)[number];
  type: (typeof TYPES_BIEN)[number] | null;
  prix: number | null;
  devise: string | null;
  periodicite: (typeof PERIODICITES)[number] | null;
  charges: number | null;
  caution: number | null;
  pays: string | null;
  ville: string | null;
  quartier: string | null;
  adresse: string | null;
  nb_chambres: number | null;
  nb_salons: number | null;
  nb_salles_bain: number | null;
  nb_pieces: number | null;
  surface_m2: number | null;
  meuble: boolean | null;
  climatise: boolean | null;
  parking: boolean | null;
  disponibilite: string | null;
  description: string | null;
  caracteristiques: string[];
  telephones: string[];
  whatsapp: string | null;
  emails: string[];
  /** Confiance par champ, entre 0 et 1. */
  confiance: Record<string, number>;
  /** Passage de la source justifiant chaque champ important. */
  extraits: Record<string, string>;
  /** Champs que l'IA a renseignés sans justification vérifiable, remis à null. */
  rejets: string[];
  /** Champs décisifs absents ou peu sûrs : l'annonce mérite une vérification humaine. */
  a_verifier: string[];
}

const MAX_MONTANT = 100_000_000_000;
// Villes étrangères sans homonyme parmi les quartiers gabonais. Volontairement courte :
// Dakar, London, Paris, Niger ou Toulon sont aussi des quartiers de Libreville.
const VILLES_ETRANGERES = ["abidjan", "cote d ivoire", "douala", "yaounde", "brazzaville", "kinshasa", "cotonou", "lome", "bamako", "ouagadougou", "casablanca"];
const SEUIL_CONFIANCE = 0.5;

/** Minuscules, sans accents ni ponctuation superflue : sert à comparer extrait et source. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    // NFKD : décompose les accents ET ramène les lettres « stylées » (𝗔, 𝟯…) à leur forme simple.
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clamp01(n: number | null | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function positiveOrNull(n: number | null, max = MAX_MONTANT): number | null {
  return n !== null && n > 0 && n <= max ? n : null;
}

function countOrNull(n: number | null): number | null {
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 50 ? n : null;
}

/**
 * Valide la réponse brute de l'IA et applique les garde-fous.
 *
 * @param raw     objet JSON renvoyé par le modèle
 * @param source  texte original de l'annonce — seule preuve admise. Le nom du groupe ou du compte
 *                où elle a été publiée n'en fait pas partie : un groupe « Maison à louer » contient
 *                aussi des publicités sans rapport.
 *
 * @example
 * sanitizeExtraction({ est_immobilier: true, prix: 150000, extraits: { prix: "150k" } }, "Studio 150k Okala")
 */
export function sanitizeExtraction(raw: unknown, source: string): Extraction {
  const parsed = RawExtractionSchema.parse(raw && typeof raw === "object" ? raw : {});
  const haystack = ` ${normalizeText(source)} `;
  const proven = (extrait: string | null | undefined): boolean => {
    const needle = extrait ? normalizeText(extrait) : "";
    return needle.length >= 2 && haystack.includes(` ${needle} `);
  };
  const rejets: string[] = [];
  const extraits: Record<string, string> = {};
  const confiance: Record<string, number> = {};

  for (const [champ, valeur] of Object.entries(parsed.confiance)) confiance[champ] = clamp01(valeur);

  const values: Record<ChampJustifie, string | number | null> = {
    prix: positiveOrNull(parsed.prix),
    charges: positiveOrNull(parsed.charges),
    caution: positiveOrNull(parsed.caution),
    ville: parsed.ville,
    quartier: parsed.quartier,
    adresse: parsed.adresse,
  };

  for (const champ of CHAMPS_JUSTIFIES) {
    if (values[champ] === null) {
      delete confiance[champ];
      continue;
    }
    const extrait = parsed.extraits[champ];
    // L'extrait doit exister tel quel dans la source : c'est la preuve que la valeur n'est pas inventée.
    if (proven(extrait)) {
      extraits[champ] = extrait as string;
    } else {
      values[champ] = null;
      confiance[champ] = 0;
      rejets.push(champ);
    }
  }

  // Une publication n'est de l'immobilier que si un passage de son propre texte le montre.
  const estImmobilier = parsed.est_immobilier && proven(parsed.extraits.immobilier);
  if (parsed.est_immobilier && !estImmobilier) rejets.push("immobilier");
  if (estImmobilier) extraits.immobilier = parsed.extraits.immobilier as string;

  const horsGabon =
    (parsed.hors_gabon && proven(parsed.extraits.hors_gabon)) ||
    VILLES_ETRANGERES.some((v) => haystack.includes(` ${v} `));

  const contacts = extractContacts(source);
  const transaction = parsed.transaction ?? "inconnu";
  const prix = values.prix as number | null;

  const aVerifier: string[] = [];
  if (transaction === "inconnu" || clamp01(confiance.transaction ?? 1) < SEUIL_CONFIANCE) aVerifier.push("transaction");
  if (prix === null || clamp01(confiance.prix ?? 1) < SEUIL_CONFIANCE) aVerifier.push("prix");
  if (values.ville === null && values.quartier === null) aVerifier.push("localisation");
  if (parsed.type === null) aVerifier.push("type");

  return {
    est_immobilier: estImmobilier,
    hors_gabon: horsGabon,
    transaction,
    type: parsed.type,
    prix,
    devise: prix !== null ? (parsed.devise || "XAF").toUpperCase().replace("FCFA", "XAF") : null,
    periodicite: prix !== null && transaction !== "vente" ? parsed.periodicite : null,
    charges: values.charges as number | null,
    caution: values.caution as number | null,
    pays: parsed.pays,
    ville: values.ville as string | null,
    quartier: values.quartier as string | null,
    adresse: values.adresse as string | null,
    nb_chambres: countOrNull(parsed.nb_chambres),
    nb_salons: countOrNull(parsed.nb_salons),
    nb_salles_bain: countOrNull(parsed.nb_salles_bain),
    nb_pieces: countOrNull(parsed.nb_pieces),
    surface_m2: positiveOrNull(parsed.surface_m2, 10_000_000),
    meuble: transaction === "location_meublee" ? true : parsed.meuble,
    climatise: parsed.climatise,
    parking: parsed.parking,
    disponibilite: parsed.disponibilite,
    description: parsed.description ? parsed.description.slice(0, 600) : null,
    caracteristiques: parsed.caracteristiques.map((c) => c.trim().slice(0, 40)),
    telephones: contacts.phones,
    whatsapp: contacts.whatsapp,
    emails: contacts.emails,
    confiance,
    extraits,
    rejets,
    a_verifier: aVerifier,
  };
}

/**
 * Une publication ne devient une annonce que si c'est une OFFRE immobilière située au Gabon.
 * Les demandes (« je cherche un studio… ») et les biens à l'étranger sont écartés.
 *
 * @example if (isListing(fiche)) creerAnnonce(fiche);
 */
export function isListing(e: Pick<Extraction, "est_immobilier" | "hors_gabon" | "transaction">): boolean {
  return e.est_immobilier && !e.hors_gabon && e.transaction !== "recherche";
}

/** Détails rangés dans `annonces.details` (JSON) : tout ce qui n'a pas de colonne dédiée. */
export interface AnnonceDetails {
  version: number;
  hors_gabon: boolean;
  transaction: string;
  periodicite: string | null;
  charges: number | null;
  caution: number | null;
  pays: string | null;
  nb_salons: number | null;
  climatise: boolean | null;
  parking: boolean | null;
  disponibilite: string | null;
  telephones: string[];
  emails: string[];
  confiance: Record<string, number>;
  extraits: Record<string, string>;
  rejets: string[];
  a_verifier: string[];
}

export function toAnnonceDetails(e: Extraction): AnnonceDetails {
  return {
    version: 1,
    hors_gabon: e.hors_gabon,
    transaction: e.transaction,
    periodicite: e.periodicite,
    charges: e.charges,
    caution: e.caution,
    pays: e.pays,
    nb_salons: e.nb_salons,
    climatise: e.climatise,
    parking: e.parking,
    disponibilite: e.disponibilite,
    telephones: e.telephones,
    emails: e.emails,
    confiance: e.confiance,
    extraits: e.extraits,
    rejets: e.rejets,
    a_verifier: e.a_verifier,
  };
}

/** Étiquettes normalisées, utilisées par l'interface et par le matching. */
export function toTags(e: Extraction): string[] {
  const tags: string[] = [];
  if (e.meuble) tags.push("meublé");
  if (e.climatise) tags.push("climatisé");
  if (e.parking) tags.push("parking");
  for (const c of e.caracteristiques) {
    const t = c.toLowerCase();
    if (!tags.some((x) => normalizeText(x) === normalizeText(t))) tags.push(t);
  }
  return tags.slice(0, 12);
}
