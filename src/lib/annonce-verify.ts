import { analysePost, postText, suspicionScore, SUSPICION_THRESHOLD, type AnalysisResult, type ScraperPost } from "./ad-quality";
import { isRicherText, reanalyzeAnnonce } from "./complete-annonce";
import { extractImages } from "./extract-images";
import { autoPerDay, createScraper, readUsage, reserveCall, ScraperError, type Scraper } from "./facebook-scraper";
import { isCopyablePhoto, MAX_PER_ANNONCE } from "./photos";
import type { createServiceClient } from "./supabase/server";

// Vérification d'une annonce douteuse par RapidAPI : relecture de la publication d'origine
// (1 appel), verdict qualité, puis réparation de l'annonce (texte complet réanalysé, album photo).
// WHY: le flux RSS ne garde qu'une photo et coupe certains textes sans « … » ; la relecture
// ciblée récupère le texte entier et l'album pour une poignée d'appels par mois.

type Client = ReturnType<typeof createServiceClient>;

/** Une annonce trop récente peut encore être complétée par le flux : on attend avant de payer un appel. */
const MIN_AGE_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 60 * 60 * 60 * 1000;
const CANDIDATES = 200;

interface AnnonceRow {
  id: string;
  user_id: string;
  fb_post_id: string;
  fb_post_url: string | null;
  raw_text: string | null;
  raw_images: string[] | null;
  prix: number | null;
  quartier: string | null;
  telephone: string | null;
  whatsapp: string | null;
}

const ANNONCE_FIELDS = "id, user_id, fb_post_id, fb_post_url, raw_text, raw_images, prix, quartier, telephone, whatsapp";

export interface VerifyOutcome {
  status: AnalysisResult["status"] | "NOT_FOUND";
  score: number;
  labels: string[];
  textImproved: boolean;
  photosBefore: number;
  photosAfter: number;
  isRealEstate: boolean | null;
}

/** Seules les publications Facebook (identifiant numérique) se relisent par RapidAPI. */
export function isVerifiable(fbPostId: string | null | undefined): boolean {
  return typeof fbPostId === "string" && /^\d{5,}$/.test(fbPostId);
}

/** Photos de la publication relue, téléchargeables, sans doublon. */
export function postPhotos(post: ScraperPost): string[] {
  const urls = extractImages(post as Record<string, unknown>).filter(isCopyablePhoto);
  const seen = new Set<string>();
  return urls.filter((u) => {
    const stable = u.split("?")[0];
    if (seen.has(stable)) return false;
    seen.add(stable);
    return true;
  });
}

async function saveCheck(client: Client, row: Record<string, unknown>) {
  const { error } = await client.from("fb_group_posts_checks").upsert({ ...row, checked_at: new Date().toISOString() }, { onConflict: "post_id" });
  if (error) console.error("fb_group_posts_checks:", error.message);
}

/**
 * Relit une annonce par RapidAPI, enregistre le verdict et répare l'annonce si la publication
 * d'origine est plus complète. `auto` impute l'appel au quota automatique du jour.
 *
 * @example const outcome = await verifyAnnonce(service, annonceId, user.id, { auto: false })
 */
export async function verifyAnnonce(
  client: Client,
  annonceId: string,
  userId: string,
  opts: { auto?: boolean; legacyAiKey?: string | null; scraper?: Scraper } = {},
): Promise<VerifyOutcome> {
  const { data } = await client.from("annonces").select(ANNONCE_FIELDS).eq("id", annonceId).eq("user_id", userId).maybeSingle();
  const annonce = data as AnnonceRow | null;
  if (!annonce) throw new ScraperError("not_found", "Annonce introuvable.");
  if (!isVerifiable(annonce.fb_post_id)) throw new ScraperError("not_found", "Seules les annonces de groupes Facebook peuvent être vérifiées.");

  const scraper = opts.scraper ?? createScraper({ beforeRequest: () => reserveCall(client, { auto: opts.auto }) });
  const post = await scraper.getPost(annonce.fb_post_id);
  const photosBefore = (annonce.raw_images || []).length;
  const trigger = opts.auto ? "auto" : "manual";

  if (!post) {
    await saveCheck(client, { post_id: annonce.fb_post_id, annonce_id: annonce.id, url: annonce.fb_post_url, status: "NOT_FOUND", score: 0, issues: [], extracted: {}, raw: null, trigger });
    return { status: "NOT_FOUND", score: 0, labels: ["Publication introuvable (supprimée ou privée)"], textImproved: false, photosBefore, photosAfter: photosBefore, isRealEstate: null };
  }

  const analysis = analysePost(post);
  const text = postText(post).trim();
  let textImproved = false;
  let isRealEstate: boolean | null = null;
  if (text && isRicherText(text, annonce.raw_text)) {
    const result = await reanalyzeAnnonce(client, { annonceId: annonce.id, userId, text, legacyAiKey: opts.legacyAiKey });
    if (result.ok) {
      textImproved = true;
      isRealEstate = result.isRealEstate;
    }
  }

  // L'album remplace la photo unique du flux ; le cron de collecte copie ensuite les photos dans le stockage.
  const photos = postPhotos(post).slice(0, MAX_PER_ANNONCE);
  let photosAfter = photosBefore;
  if (photos.length > photosBefore) {
    const { error } = await client.from("annonces").update({ raw_images: photos }).eq("id", annonce.id).eq("user_id", userId);
    if (!error) photosAfter = photos.length;
  }

  await saveCheck(client, {
    post_id: annonce.fb_post_id,
    annonce_id: annonce.id,
    group_id: (post.associated_group as { group_id?: string } | undefined)?.group_id ?? null,
    url: analysis.url ?? annonce.fb_post_url,
    status: analysis.status,
    score: analysis.score,
    issues: analysis.issues,
    extracted: { ...analysis.extracted, textImproved, photosBefore, photosAfter },
    raw: post,
    trigger,
  });

  return { status: analysis.status, score: analysis.score, labels: analysis.labels, textImproved, photosBefore, photosAfter, isRealEstate };
}

/**
 * Annonce la plus douteuse pas encore vérifiée, parmi celles des agents autorisés :
 * publiée depuis plus de 30 min et moins de 60 h, issue d'un groupe Facebook.
 */
export async function pickSuspicious(client: Client, allowedUserIds: Set<string> | null, now = Date.now()): Promise<AnnonceRow | null> {
  const { data } = await client
    .from("annonces")
    .select(ANNONCE_FIELDS)
    .eq("ai_is_real_estate", true)
    .neq("status", "archived")
    .gte("created_at", new Date(now - MAX_AGE_MS).toISOString())
    .lte("created_at", new Date(now - MIN_AGE_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(CANDIDATES);
  const rows = ((data || []) as AnnonceRow[]).filter(
    (a) => isVerifiable(a.fb_post_id) && (!allowedUserIds || allowedUserIds.has(a.user_id)) && suspicionScore(a) >= SUSPICION_THRESHOLD,
  );
  if (!rows.length) return null;

  const { data: done, error } = await client.from("fb_group_posts_checks").select("post_id").in("post_id", rows.map((r) => r.fb_post_id));
  // Table absente (script SQL pas encore exécuté) : sans mémoire des vérifications, on s'abstient.
  if (error) return null;
  const checked = new Set(((done || []) as { post_id: string }[]).map((d) => d.post_id));
  return rows.filter((r) => !checked.has(r.fb_post_id)).sort((a, b) => suspicionScore(b) - suspicionScore(a))[0] ?? null;
}

/**
 * Vérification automatique plafonnée : au plus RAPIDAPI_AUTO_PER_DAY annonces par jour, la plus
 * douteuse d'abord. Appelée par le cron de collecte ; ne fait rien sans clé ou quota épuisé.
 *
 * @example await autoVerify(service, allowedIds) // { checked: 1, … } ou { skipped: "quota du jour" }
 */
export async function autoVerify(client: Client, allowedUserIds: Set<string> | null): Promise<Record<string, unknown>> {
  if (!process.env.RAPIDAPI_KEY) return { skipped: "clé absente" };
  if (autoPerDay() === 0) return { skipped: "désactivée" };
  const usage = await readUsage(client);
  if (usage.autoCalls >= autoPerDay()) return { skipped: "quota du jour" };

  const annonce = await pickSuspicious(client, allowedUserIds);
  if (!annonce) return { skipped: "aucune annonce douteuse" };

  const { data: owner } = await client.from("profiles").select("kimi_api_key").eq("id", annonce.user_id).maybeSingle();
  try {
    const outcome = await verifyAnnonce(client, annonce.id, annonce.user_id, { auto: true, legacyAiKey: (owner?.kimi_api_key as string | null) || null });
    return { checked: 1, annonceId: annonce.id, ...outcome };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "erreur" };
  }
}
