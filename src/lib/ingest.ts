import { analyzePost } from "./ai";
import { annonceFieldsFromAnalysis } from "./annonce-fields";
import type { createServiceClient } from "./supabase/server";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type IngestStatus = "known" | "not_real_estate" | "out_of_area" | "new_annonce" | "ai_error";

export interface IngestInput {
  userId: string;
  /** Source : groupe (facebook_groups), profil d'agent (agent_profiles) ou compte TikTok. */
  sourceType: "group" | "profile" | "tiktok";
  /** Identifiant (uuid) de la ligne facebook_groups ou agent_profiles ; sans objet pour TikTok. */
  sourceRowId: string | null;
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
  /** Appelé quand la publication est rencontrée pour la toute première fois. */
  onFirstSeen?: () => void;
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
    input.onFirstSeen?.();
    const { data: rawPost } = await client
      .from("raw_posts")
      .insert({
        user_id: input.userId,
        ...(input.sourceType === "group" ? { fb_group_id: input.sourceRowId } : {}),
        ...(input.sourceType === "profile" ? { agent_profile_id: input.sourceRowId } : {}),
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

const REPROCESS_WINDOW_DAYS = 7;

/**
 * Ré-analyse les publications mémorisées restées « en attente » ou « en erreur »,
 * même si elles ont quitté le flux. Sert à rattraper une panne de l'IA, ou à
 * reclasser des publications après correction du prompt (remises en attente par SQL).
 *
 * @returns nombre de publications par résultat
 * @example const counts = await reprocessPending(client, 40);
 */
export async function reprocessPending(
  client: ServiceClient,
  limit: number,
  onAiError?: (message: string) => void
): Promise<Partial<Record<IngestStatus, number>>> {
  const counts: Partial<Record<IngestStatus, number>> = {};
  if (limit <= 0) return counts;

  const since = new Date(Date.now() - REPROCESS_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: rows } = await client
    .from("raw_posts")
    .select("user_id, fb_group_id, agent_profile_id, source_type, fb_post_id, fb_post_url, fb_author_name, fb_author_id, raw_text, raw_images, fb_posted_at")
    .in("ai_status", ["pending", "error"])
    .in("source_type", ["group", "profile", "tiktok"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  for (const row of rows || []) {
    const sourceType = row.source_type === "profile" ? "profile" : row.source_type === "tiktok" ? "tiktok" : "group";
    const sourceRowId =
      sourceType === "group"
        ? (row.fb_group_id as string | null)
        : sourceType === "profile"
          ? (row.agent_profile_id as string | null)
          : null;
    const text = typeof row.raw_text === "string" ? row.raw_text.trim() : "";
    // Un post Facebook dont la source a été supprimée n'est plus rattachable : on le laisse.
    if (!text || (sourceType !== "tiktok" && !sourceRowId)) continue;

    const status = await ingestPost(client, {
      userId: row.user_id as string,
      sourceType,
      sourceRowId,
      authorId: (row.fb_author_id as string | null) ?? null,
      postId: row.fb_post_id as string,
      url: (row.fb_post_url as string | null) ?? null,
      author: (row.fb_author_name as string | null) ?? null,
      text,
      images: Array.isArray(row.raw_images) ? (row.raw_images as string[]) : [],
      publishedAt: (row.fb_posted_at as string | null) ?? null,
      onAiError,
    });
    counts[status] = (counts[status] || 0) + 1;
  }

  return counts;
}
