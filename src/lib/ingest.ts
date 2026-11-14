import { analyzePost } from "./ai";
import { annonceFieldsFromAnalysis } from "./annonce-fields";
import type { createServiceClient } from "./supabase/server";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type IngestStatus = "known" | "not_real_estate" | "out_of_area" | "new_annonce" | "ai_error";

export interface IngestInput {
  userId: string;
  /** Source : groupe (ligne facebook_groups) ou profil d'agent (ligne agent_profiles). */
  sourceType: "group" | "profile";
  /** Identifiant (uuid) de la ligne facebook_groups ou agent_profiles. */
  sourceRowId: string;
  /** Identifiant Facebook de l'auteur, connu pour un profil d'agent. */
  authorId?: string | null;
  postId: string;
  url: string | null;
  author: string | null;
  text: string;
  images: string[];
  publishedAt: string | null;
  /** Clé IA propre au compte, utilisée seulement en repli (voir lib/ai.ts). */
  legacyAiKey?: string | null;
  /** Appelé avec le message d'erreur quand l'analyse IA échoue (pour le diagnostic). */
  onAiError?: (message: string) => void;
}

/**
 * Enregistre une publication (groupe ou profil d'agent) : mémorisation dans raw_posts, analyse IA,
 * puis création de l'annonce si c'est de l'immobilier.
 *
 * WHY: chaque publication est mémorisée, y compris les non-immobilières, pour ne
 * jamais renvoyer deux fois le même texte à l'IA. Une publication restée en erreur
 * ou en attente est retentée au passage suivant.
 */
export async function ingestPost(client: ServiceClient, input: IngestInput): Promise<IngestStatus> {
  const { data: seen } = await client
    .from("raw_posts")
    .select("id, ai_status")
    .eq("user_id", input.userId)
    .eq("fb_post_id", input.postId)
    .maybeSingle();

  if (seen && seen.ai_status !== "error" && seen.ai_status !== "pending") return "known";

  const { data: existing } = await client
    .from("annonces")
    .select("id")
    .eq("user_id", input.userId)
    .eq("fb_post_id", input.postId)
    .maybeSingle();

  if (existing) return "known";

  let rawPostId = seen?.id as string | undefined;
  if (!rawPostId) {
    const { data: rawPost } = await client
      .from("raw_posts")
      .insert({
        user_id: input.userId,
        ...(input.sourceType === "group"
          ? { fb_group_id: input.sourceRowId }
          : { agent_profile_id: input.sourceRowId }),
        source_type: input.sourceType,
        fb_post_id: input.postId,
        fb_post_url: input.url,
        fb_author_name: input.author,
        raw_text: input.text,
        raw_images: input.images,
        fb_posted_at: input.publishedAt,
        ai_status: "pending",
      })
      .select("id")
      .single();
    rawPostId = rawPost?.id as string | undefined;
  }

  try {
    const analysis = await analyzePost(input.text, input.legacyAiKey);

    if (rawPostId) {
      await client
        .from("raw_posts")
        .update({
          ai_result: analysis as unknown as Record<string, unknown>,
          ai_status: analysis.is_real_estate ? "real_estate" : "not_real_estate",
          ai_error: null,
        })
        .eq("id", rawPostId);
    }

    if (analysis.details.hors_gabon) return "out_of_area";
    if (!analysis.is_real_estate) return "not_real_estate";

    const { data: annonce } = await client
      .from("annonces")
      .insert({
        user_id: input.userId,
        fb_post_id: input.postId,
        fb_post_url: input.url,
        fb_group_id: input.sourceType === "group" ? input.sourceRowId : null,
        fb_author_name: input.author,
        fb_author_id: input.authorId || null,
        fb_posted_at: input.publishedAt,
        raw_text: input.text,
        raw_images: input.images,
        ...(await annonceFieldsFromAnalysis(client, analysis)),
      })
      .select("id")
      .single();

    if (annonce && rawPostId) {
      await client.from("raw_posts").update({ annonce_id: annonce.id }).eq("id", rawPostId);
    }
    return "new_annonce";
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Erreur IA";
    input.onAiError?.(message);
    if (rawPostId) {
      await client
        .from("raw_posts")
        .update({
          ai_status: "error",
          ai_error: message,
        })
        .eq("id", rawPostId);
    }
    return "ai_error";
  }
}
