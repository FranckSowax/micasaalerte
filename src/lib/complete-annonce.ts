import { analyzePost } from "./ai";
import { annonceFieldsFromAnalysis } from "./annonce-fields";
import { imageTextOf, withImageText } from "./ocr";
import type { createServiceClient } from "./supabase/server";

// Annonces dont le texte collecté est incomplet.
// WHY: pour certaines publications (première ligne mise en titre par Facebook, suite repliée
// sous « Voir plus »), le flux ne transmet que cette première ligne. L'IA n'a alors ni le
// quartier, ni le prix, ni le contact. Deux remèdes : l'agent colle le texte complet, ou le flux
// finit par fournir une version plus longue ; dans les deux cas l'annonce est réanalysée.

type Client = ReturnType<typeof createServiceClient>;

/** En dessous de cette longueur, un texte d'annonce est presque toujours une simple première ligne. */
export const TRUNCATED_BELOW = 120;
export const MAX_COMPLETED_TEXT = 5000;

/**
 * Le texte ressemble-t-il à une publication tronquée par le flux ?
 *
 * @example looksTruncated("LOCATION APPARTEMENT 3CHAMBRES /BON STANDING |") // true
 */
export function looksTruncated(text: string | null | undefined): boolean {
  return (text || "").trim().length < TRUNCATED_BELOW;
}

/**
 * Un nouveau texte apporte-t-il assez pour justifier une réanalyse ? Il doit être nettement plus
 * long, pas seulement différer d'un espace ou d'un émoji.
 *
 * @example isRicherText(texteDuFlux, annonce.raw_text)
 */
export function isRicherText(next: string | null | undefined, current: string | null | undefined): boolean {
  const a = (next || "").trim().length;
  const b = (current || "").trim().length;
  return a >= b + 60 && a >= b * 1.5;
}

export type ReanalyzeResult = { ok: true; isRealEstate: boolean } | { ok: false; error: string };

/**
 * Réanalyse une annonce existante avec un texte plus complet et met à jour ses champs.
 * Ce qui a été ajouté depuis sa création (versions de prix, diffusions, retrait, avis du modèle)
 * est conservé : seuls les champs issus de l'analyse sont remplacés.
 *
 * @example await reanalyzeAnnonce(supabase, { annonceId, userId, text })
 */
export async function reanalyzeAnnonce(
  client: Client,
  params: { annonceId: string; userId: string; text: string; legacyAiKey?: string | null; imageText?: string }
): Promise<ReanalyzeResult> {
  const caption = params.text.trim().slice(0, MAX_COMPLETED_TEXT);
  if (!caption) return { ok: false, error: "Texte vide" };

  const { data: current } = await client.from("annonces").select("id, details, raw_text").eq("id", params.annonceId).eq("user_id", params.userId).maybeSingle();
  if (!current) return { ok: false, error: "Annonce introuvable" };

  // Le texte lu sur l'image (TikTok) à la création de l'annonce reste dans l'analyse.
  const text = withImageText(caption, params.imageText || imageTextOf(current.raw_text as string | null));

  let analysis;
  try {
    analysis = await analyzePost(text, params.legacyAiKey);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "Erreur IA" };
  }

  const fields = (await annonceFieldsFromAnalysis(client, analysis)) as Record<string, unknown>;
  const oldDetails = current.details && typeof current.details === "object" ? (current.details as Record<string, unknown>) : {};
  const newDetails = fields.details && typeof fields.details === "object" ? (fields.details as Record<string, unknown>) : null;
  const update = { ...fields, raw_text: text, ...(newDetails ? { details: { ...oldDetails, ...newDetails } } : {}) };

  const { error } = await client.from("annonces").update(update).eq("id", params.annonceId).eq("user_id", params.userId);
  if (error) return { ok: false, error: "Enregistrement impossible" };

  // La publication mémorisée suit, pour que la collecte ne retraite pas le même texte.
  // La légende seule : c'est à elle que la collecte compare le texte du flux.
  await client.from("raw_posts").update({ raw_text: caption }).eq("annonce_id", params.annonceId);
  return { ok: true, isRealEstate: analysis.is_real_estate };
}
