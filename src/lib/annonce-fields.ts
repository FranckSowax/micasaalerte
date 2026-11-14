import type { AIExtractionResult } from "./ai";
import { locateAnnonce } from "./geo";
import type { createServiceClient } from "./supabase/server";

type ServiceClient = ReturnType<typeof createServiceClient>;

// WHY: la colonne `annonces.details` est ajoutée par une migration SQL lancée à la main.
// Tant qu'elle n'existe pas, l'inclure ferait échouer chaque insertion d'annonce :
// on vérifie donc sa présence (résultat mis en cache) avant de l'écrire.
const RECHECK_MS = 5 * 60_000;
let detailsColumn: { present: boolean; checkedAt: number } | null = null;

export async function hasDetailsColumn(client: ServiceClient): Promise<boolean> {
  if (detailsColumn && (detailsColumn.present || Date.now() - detailsColumn.checkedAt < RECHECK_MS)) {
    return detailsColumn.present;
  }
  const { error } = await client.from("annonces").select("details").limit(1);
  detailsColumn = { present: !error, checkedAt: Date.now() };
  return detailsColumn.present;
}

/**
 * Colonnes de la table `annonces` issues de l'analyse d'une publication.
 * À étaler dans l'objet d'insertion, à côté des champs propres à la source.
 *
 * @example
 * await client.from("annonces").insert({ user_id, fb_post_id, raw_text,
 *   ...(await annonceFieldsFromAnalysis(client, analysis)) });
 */
export async function annonceFieldsFromAnalysis(client: ServiceClient, analysis: AIExtractionResult) {
  const fields = {
    type_bien: analysis.type_bien,
    type_offre: analysis.type_offre,
    prix: analysis.prix,
    devise: analysis.devise || "FCFA",
    nb_pieces: analysis.nb_pieces,
    nb_chambres: analysis.nb_chambres,
    nb_salles_bain: analysis.nb_salles_bain,
    superficie: analysis.superficie,
    meuble: analysis.meuble,
    quartier: analysis.quartier,
    // Pas de ville par défaut : une ville non écrite dans la source reste inconnue.
    ville: analysis.ville,
    adresse_complete: analysis.adresse_complete,
    telephone: analysis.telephone,
    whatsapp: analysis.whatsapp,
    email: analysis.email,
    ai_confidence: analysis.confidence,
    ai_summary: analysis.summary,
    ai_is_real_estate: true,
    ai_tags: analysis.tags || [],
  };

  // Localisation sur le référentiel de lieux : coordonnées pour le matching par rayon et la carte.
  const geo = locateAnnonce({ quartier: fields.quartier, adresse_complete: fields.adresse_complete, ville: fields.ville });
  // Le quartier reconnu prend son nom officiel (« angondje entraco » → « Angondjé ») ; l'écriture d'origine est conservée.
  const quartier = geo && geo.precision !== "ville" ? geo.lieu : fields.quartier;
  const located = { ...fields, quartier };

  if (!(await hasDetailsColumn(client))) return located;
  return {
    ...located,
    details: { ...analysis.details, geo, ...(quartier !== fields.quartier ? { quartier_texte: fields.quartier } : {}) },
  };
}
