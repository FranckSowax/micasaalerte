import { analyzePost, readImageText } from "./ai";
import { annonceFieldsFromAnalysis, hasDetailsColumn } from "./annonce-fields";
import { isRicherText, reanalyzeAnnonce } from "./complete-annonce";
import { normalizePhone } from "./contacts";
import {
  DEDUPE_WINDOW_DAYS,
  findListingDuplicate,
  findTextDuplicate,
  fingerprint,
  type Candidate,
  type Fingerprint,
} from "./dedupe";
import { IMAGE_TEXT_HEADING, shouldReadImages, withImageText } from "./ocr";
import type { createServiceClient } from "./supabase/server";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type IngestStatus =
  | "known"
  /** Publication connue dont le flux fournit maintenant un texte plus complet : annonce réanalysée. */
  | "enriched"
  | "not_real_estate"
  | "out_of_area"
  | "duplicate"
  | "price_update"
  | "new_annonce"
  | "ai_error";

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
  /** Appelé après la lecture des images (TikTok) : indique si du texte y a été trouvé. */
  onImageText?: (info: { found: boolean }) => void;
  /** Appelé à la création d'une annonce : indique si elle a pu être placée sur la carte. */
  onNewAnnonce?: (info: { located: boolean }) => void;
}

const MAX_CANDIDATES = 1000;
const MAX_SOURCES = 20;

interface IndexedAnnonce extends Candidate {
  status: string;
  createdAt: string;
  postId: string;
  url: string | null;
  author: string | null;
}

function phonesOf(...values: unknown[]): string[] {
  const phones = new Set<string>();
  for (const value of values.flat()) {
    const n = typeof value === "string" ? normalizePhone(value) : null;
    if (n) phones.add(n);
  }
  return Array.from(phones);
}

/**
 * Annonces récentes de chaque compte, chargées une fois par passage, auxquelles
 * les nouvelles publications sont comparées pour repérer les doublons.
 */
export class DedupeIndex {
  private byUser = new Map<string, IndexedAnnonce[]>();

  async get(client: ServiceClient, userId: string): Promise<IndexedAnnonce[]> {
    const cached = this.byUser.get(userId);
    if (cached) return cached;

    const since = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 86_400_000).toISOString();
    const withDetails = await hasDetailsColumn(client);
    const { data } = await client
      .from("annonces")
      .select(
        `id, status, created_at, fb_post_id, fb_post_url, fb_author_name, raw_text, type_offre, type_bien, prix, quartier, nb_chambres, telephone, whatsapp${withDetails ? ", details" : ""}`
      )
      .eq("user_id", userId)
      .eq("ai_is_real_estate", true)
      .neq("status", "archived")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_CANDIDATES);

    const list = ((data || []) as unknown as Record<string, unknown>[]).map((row) => {
      const details = (row.details && typeof row.details === "object" ? row.details : {}) as { telephones?: unknown };
      return {
        id: row.id as string,
        status: (row.status as string) || "new",
        createdAt: (row.created_at as string) || "",
        postId: (row.fb_post_id as string) || "",
        url: (row.fb_post_url as string | null) ?? null,
        author: (row.fb_author_name as string | null) ?? null,
        fp: fingerprint((row.raw_text as string) || ""),
        type_offre: (row.type_offre as string | null) ?? null,
        type_bien: (row.type_bien as string | null) ?? null,
        prix: row.prix === null || row.prix === undefined ? null : Number(row.prix),
        quartier: (row.quartier as string | null) ?? null,
        nb_chambres: (row.nb_chambres as number | null) ?? null,
        phones: phonesOf(row.telephone, row.whatsapp, Array.isArray(details.telephones) ? details.telephones : []),
      } satisfies IndexedAnnonce;
    });

    this.byUser.set(userId, list);
    return list;
  }

  add(userId: string, annonce: IndexedAnnonce) {
    this.byUser.get(userId)?.unshift(annonce);
  }

  remove(userId: string, annonceId: string) {
    const list = this.byUser.get(userId);
    if (list) this.byUser.set(userId, list.filter((a) => a.id !== annonceId));
  }
}

interface SourceRef {
  post_id: string;
  url: string | null;
  author: string | null;
  source: string;
  at: string;
}

/** Ajoute une diffusion supplémentaire à l'annonce existante (autre groupe, autre diffuseur, autre date). */
async function addSource(client: ServiceClient, annonceId: string, source: SourceRef, extra: Record<string, unknown> = {}) {
  if (!(await hasDetailsColumn(client))) {
    if (Object.keys(extra).some((k) => k !== "details")) await client.from("annonces").update(extra).eq("id", annonceId);
    return;
  }
  const { data } = await client.from("annonces").select("details").eq("id", annonceId).maybeSingle();
  const details = (data?.details && typeof data.details === "object" ? data.details : {}) as Record<string, unknown>;
  const sources = Array.isArray(details.sources) ? (details.sources as SourceRef[]) : [];
  const { details: detailsPatch, ...columns } = extra as { details?: Record<string, unknown> };

  const next = sources.some((s) => s.post_id === source.post_id) ? sources : [...sources, source].slice(-MAX_SOURCES);
  await client
    .from("annonces")
    .update({ ...columns, details: { ...details, ...(detailsPatch || {}), sources: next, diffusions: next.length + 1 } })
    .eq("id", annonceId);
}

/** Rattache une publication en double à l'annonce qu'elle répète, sans créer d'annonce. */
async function linkDuplicate(client: ServiceClient, rawPostId: string | undefined, annonceId: string) {
  if (!rawPostId) return;
  const { error } = await client
    .from("raw_posts")
    .update({ ai_status: "duplicate", annonce_id: annonceId, ai_error: null })
    .eq("id", rawPostId);
  // Base plus ancienne dont la contrainte ne connaît pas l'état « duplicate » : on garde le rattachement.
  if (error) {
    await client.from("raw_posts").update({ ai_status: "real_estate", annonce_id: annonceId, ai_error: null }).eq("id", rawPostId);
  }
}

function sourceRef(input: IngestInput): SourceRef {
  return { post_id: input.postId, url: input.url, author: input.author, source: input.sourceType, at: new Date().toISOString() };
}

/**
 * Enregistre une publication (groupe, profil d'agent ou compte TikTok) : mémorisation
 * dans raw_posts, recherche de doublon, analyse IA, puis création de l'annonce.
 *
 * WHY: chaque publication est mémorisée, y compris les non-immobilières, pour ne
 * jamais renvoyer deux fois le même texte à l'IA. Une publication restée en erreur
 * ou en attente est retentée au passage suivant.
 *
 * @param index annonces récentes servant à repérer les doublons ; sans lui, pas de dédoublonnage
 */
export async function ingestPost(client: ServiceClient, input: IngestInput, index?: DedupeIndex): Promise<IngestStatus> {
  const { data: seen } = await client
    .from("raw_posts")
    .select("id, ai_status, raw_text")
    .eq("user_id", input.userId)
    .eq("fb_post_id", input.postId)
    .maybeSingle();

  if (seen && seen.ai_status !== "error" && seen.ai_status !== "pending") {
    // Publication déjà connue, mais le flux en donne maintenant un texte nettement plus complet
    // (la première fois, seule la première ligne était arrivée) : l'annonce est réanalysée.
    // Sans texte mémorisé à comparer, on ne conclut rien.
    if (typeof seen.raw_text === "string" && seen.raw_text && isRicherText(input.text, seen.raw_text)) {
      await client.from("raw_posts").update({ raw_text: input.text }).eq("id", seen.id);
      const { data: annonce } = await client.from("annonces").select("id").eq("user_id", input.userId).eq("fb_post_id", input.postId).maybeSingle();
      if (annonce) {
        const result = await reanalyzeAnnonce(client, { annonceId: annonce.id as string, userId: input.userId, text: input.text, legacyAiKey: input.legacyAiKey });
        if (result.ok) return "enriched";
        input.onAiError?.(result.error);
      }
    }
    return "known";
  }

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

  // TikTok : l'annonce est souvent écrite sur l'image, la légende se limitant à des mots-dièse.
  // Le texte lu sur l'image s'ajoute à la légende AVANT la recherche de doublons : deux vidéos
  // d'un même compte partagent souvent la même légende sans décrire le même bien.
  let text = input.text.trim();
  if (shouldReadImages(input)) {
    try {
      const imageText = await readImageText(input.images);
      input.onImageText?.({ found: !!imageText });
      text = withImageText(text, imageText);
    } catch (error) {
      const message = `Lecture de l'image : ${error instanceof Error ? error.message.slice(0, 300) : "erreur"}`;
      input.onAiError?.(message);
      if (rawPostId) await client.from("raw_posts").update({ ai_status: "error", ai_error: message }).eq("id", rawPostId);
      return "ai_error";
    }
  }
  if (!text) {
    // Ni légende, ni texte lisible sur l'image : rien à analyser.
    if (rawPostId) await client.from("raw_posts").update({ ai_status: "not_real_estate", ai_error: "Aucun texte lisible" }).eq("id", rawPostId);
    return "not_real_estate";
  }

  const fp: Fingerprint = fingerprint(text);
  const candidates = index ? await index.get(client, input.userId) : [];

  // Étape 1 : texte quasi identique à une annonce récente → doublon, sans appel à l'IA.
  const textDuplicate = findTextDuplicate(fp, candidates, input.author);
  if (textDuplicate) {
    await linkDuplicate(client, rawPostId, textDuplicate.candidate.id);
    await addSource(client, textDuplicate.candidate.id, sourceRef(input));
    return "duplicate";
  }

  try {
    const analysis = await analyzePost(text, input.legacyAiKey);

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

    const key = {
      type_offre: analysis.type_offre,
      type_bien: analysis.type_bien,
      prix: analysis.prix,
      quartier: analysis.quartier,
      nb_chambres: analysis.nb_chambres,
      phones: phonesOf(analysis.telephone, analysis.whatsapp, analysis.details.telephones),
    };

    // Étape 2 : même fiche, ou même texte avec un prix modifié.
    const match = findListingDuplicate(fp, key, candidates);
    if (match) {
      const target = match.candidate;
      await linkDuplicate(client, rawPostId, target.id);

      if (match.kind === "price_update" && analysis.prix) {
        const { data: current } = await client.from("annonces").select("*").eq("id", target.id).maybeSingle();
        const details = (current?.details && typeof current.details === "object" ? current.details : {}) as Record<string, unknown>;
        const history = Array.isArray(details.historique_prix) ? details.historique_prix : [];
        // Nouvelle version de l'annonce : les abonnés concernés pourront être alertés du nouveau prix.
        await addSource(client, target.id, sourceRef(input), {
          prix: analysis.prix,
          details: {
            version: (typeof details.version === "number" ? details.version : 1) + 1,
            historique_prix: [...history, { prix: target.prix, jusqu_au: new Date().toISOString() }].slice(-10),
          },
        });
        target.prix = analysis.prix;
        target.fp = fp;
        return "price_update";
      }

      await addSource(client, target.id, sourceRef(input));
      return "duplicate";
    }

    const fields = await annonceFieldsFromAnalysis(client, analysis);
    const geo = (fields as { details?: { geo?: unknown } }).details?.geo;
    input.onNewAnnonce?.({ located: !!geo });

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
        // Légende complétée du texte lu sur l'image : c'est ce texte qui a été analysé.
        raw_text: text,
        raw_images: input.images,
        ...fields,
      })
      .select("id")
      .single();

    if (annonce) {
      if (rawPostId) await client.from("raw_posts").update({ annonce_id: annonce.id }).eq("id", rawPostId);
      index?.add(input.userId, {
        id: annonce.id as string,
        status: "new",
        createdAt: new Date().toISOString(),
        postId: input.postId,
        url: input.url,
        author: input.author,
        fp,
        ...key,
      });
    }
    return "new_annonce";
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Erreur IA";
    input.onAiError?.(message);
    if (rawPostId) {
      await client.from("raw_posts").update({ ai_status: "error", ai_error: message }).eq("id", rawPostId);
    }
    return "ai_error";
  }
}

/**
 * Fusionne les doublons déjà présents parmi les annonces récentes d'un compte :
 * la plus ancienne est conservée, les répétitions sont archivées et lui sont
 * rattachées comme diffusions supplémentaires. Rien n'est supprimé.
 * Seules les annonces encore « nouvelles » sont archivées ; favoris et annonces déjà envoyées sont laissés.
 *
 * @returns nombre d'annonces archivées
 */
export async function mergeExistingDuplicates(client: ServiceClient, index: DedupeIndex, userId: string): Promise<number> {
  const all = await index.get(client, userId);
  const oldestFirst = [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const kept: IndexedAnnonce[] = [];
  let merged = 0;

  for (const annonce of oldestFirst) {
    const match = findTextDuplicate(annonce.fp, kept, annonce.author) ?? findListingDuplicate(annonce.fp, annonce, kept);
    if (!match || match.kind === "price_update" || annonce.status !== "new") {
      kept.push(annonce);
      continue;
    }

    await client.from("annonces").update({ status: "archived" }).eq("id", annonce.id);
    await client.from("raw_posts").update({ annonce_id: match.candidate.id }).eq("annonce_id", annonce.id);
    await addSource(client, match.candidate.id, {
      post_id: annonce.postId,
      url: annonce.url,
      author: annonce.author,
      source: "fusion",
      at: new Date().toISOString(),
    });
    index.remove(userId, annonce.id);
    merged++;
  }

  return merged;
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
  onAiError?: (message: string) => void,
  index?: DedupeIndex
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
    const images = Array.isArray(row.raw_images) ? (row.raw_images as string[]) : [];
    // Un post TikTok sans légende reste analysable : son annonce est sur l'image.
    if (!text && !(sourceType === "tiktok" && images.length)) continue;
    // Un post Facebook dont la source a été supprimée n'est plus rattachable : on le laisse.
    if (sourceType !== "tiktok" && !sourceRowId) continue;

    const status = await ingestPost(
      client,
      {
        userId: row.user_id as string,
        sourceType,
        sourceRowId,
        authorId: (row.fb_author_id as string | null) ?? null,
        postId: row.fb_post_id as string,
        url: (row.fb_post_url as string | null) ?? null,
        author: (row.fb_author_name as string | null) ?? null,
        text,
        images,
        publishedAt: (row.fb_posted_at as string | null) ?? null,
        onAiError,
      },
      index
    );
    counts[status] = (counts[status] || 0) + 1;
  }

  return counts;
}

export type RereadStatus = "enriched" | "reanalyzed" | "no_text" | "skipped" | "ai_error";

/**
 * Relecture ponctuelle des images d'une publication TikTok déjà traitée avant la lecture des images.
 * Seules les publications restées incomplètes sont relues :
 *  - écartées comme non immobilières (la légende ne contenait que des mots-dièse) → nouvelle analyse complète ;
 *  - annonces créées sans prix ou sans quartier → annonce réanalysée avec le texte lu sur l'image.
 * Les publications rattachées à une autre annonce (doublons) ne sont pas touchées.
 * Les liens d'images doivent venir du flux du jour : ceux mémorisés ont souvent expiré.
 *
 * @example await rereadTiktokImages(client, input, dedupe) // "enriched"
 */
export async function rereadTiktokImages(client: ServiceClient, input: IngestInput, index?: DedupeIndex): Promise<RereadStatus> {
  if (!shouldReadImages(input)) return "skipped";
  const { data: seen } = await client
    .from("raw_posts")
    .select("id, ai_status")
    .eq("user_id", input.userId)
    .eq("fb_post_id", input.postId)
    .maybeSingle();
  if (!seen) return "skipped";

  if (seen.ai_status === "not_real_estate") {
    // Remise en attente : la collecte normale relit l'image puis analyse la publication.
    await client.from("raw_posts").update({ ai_status: "pending", ai_error: null }).eq("id", seen.id);
    const status = await ingestPost(client, input, index);
    if (status === "ai_error") return "ai_error";
    return status === "not_real_estate" ? "no_text" : "reanalyzed";
  }

  const { data: annonce } = await client
    .from("annonces")
    .select("id, raw_text, prix, quartier")
    .eq("user_id", input.userId)
    .eq("fb_post_id", input.postId)
    .maybeSingle();
  if (!annonce) return "skipped";
  const rawText = typeof annonce.raw_text === "string" ? annonce.raw_text : "";
  if (rawText.includes(IMAGE_TEXT_HEADING) || (annonce.prix && annonce.quartier)) return "skipped";

  let imageText: string;
  try {
    imageText = await readImageText(input.images);
  } catch (error) {
    input.onAiError?.(`Lecture de l'image : ${error instanceof Error ? error.message.slice(0, 300) : "erreur"}`);
    return "ai_error";
  }
  input.onImageText?.({ found: !!imageText });
  if (!imageText) return "no_text";

  const result = await reanalyzeAnnonce(client, {
    annonceId: annonce.id as string,
    userId: input.userId,
    text: rawText || input.text,
    legacyAiKey: input.legacyAiKey,
    imageText,
  });
  if (!result.ok) {
    input.onAiError?.(result.error);
    return "ai_error";
  }
  return "enriched";
}
