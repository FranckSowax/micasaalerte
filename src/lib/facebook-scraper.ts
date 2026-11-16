import type { ScraperPost } from "./ad-quality";
import type { createServiceClient } from "./supabase/server";

// Client serveur de RapidAPI « Facebook Scraper » (facebook-scraper3, krasnoludkolo).
// La clé RAPIDAPI_KEY ne quitte jamais le serveur et n'est jamais journalisée.
// WHY: le forfait est plafonné par mois (100 appels sur BASIC). Chaque appel est donc compté
// dans wa_settings, et un plafond (RAPIDAPI_MONTHLY_CAP) bloque avant le dépassement.

type Client = ReturnType<typeof createServiceClient>;

const HOST = "facebook-scraper3.p.rapidapi.com";
const USAGE_KEY = "rapidapi_usage";
const MIN_INTERVAL_MS = 1_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const TIMEOUT_MS = 30_000;

export type ScraperErrorCode = "no_key" | "auth" | "quota" | "budget" | "http" | "not_found";

export class ScraperError extends Error {
  constructor(
    public code: ScraperErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScraperError";
  }
}

export interface ScraperOptions {
  key?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Appelé avant chaque requête : lève une erreur pour refuser (plafond atteint). */
  beforeRequest?: () => Promise<void>;
}

export interface FetchLimits {
  maxPages?: number;
  maxPosts?: number;
  /** Arrête la pagination dès qu'une publication est plus ancienne (secondes Unix). */
  since?: number;
}

const groupIdCache = new Map<string, string>();

/**
 * Identifiant numérique d'un groupe déjà présent dans son adresse, sinon null.
 *
 * @example groupIdFromUrl("https://www.facebook.com/groups/123456789/") // "123456789"
 */
export function groupIdFromUrl(url: string): string | null {
  const match = url.match(/facebook\.com\/groups\/(\d{5,})/i);
  return match ? match[1] : /^\d{5,}$/.test(url.trim()) ? url.trim() : null;
}

/**
 * Crée un client facebook-scraper3 : une requête par seconde au plus, trois nouvelles tentatives
 * sur 429/5xx (1 s, 2 s, 4 s), arrêt immédiat sur clé refusée (401/403).
 *
 * @example
 * const scraper = createScraper({ beforeRequest: () => reserveCall(service) })
 * const post = await scraper.getPost("123")
 */
export function createScraper(options: ScraperOptions = {}) {
  const key = options.key ?? process.env.RAPIDAPI_KEY ?? "";
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastCall = 0;
  let requestsUsed = 0;

  async function call(path: string, params: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    if (!key) throw new ScraperError("no_key", "Clé RapidAPI absente : définissez RAPIDAPI_KEY sur le serveur.");
    const url = new URL(`https://${HOST}/${path}`);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      await options.beforeRequest?.();
      const wait = lastCall + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      requestsUsed++;

      let response: Response;
      try {
        response = await doFetch(url.toString(), {
          headers: { "x-rapidapi-key": key, "x-rapidapi-host": HOST },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new ScraperError("http", "RapidAPI ne répond pas.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new ScraperError("auth", "Clé RapidAPI invalide ou abonnement inactif.");
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw response.status === 429
          ? new ScraperError("quota", "Quota RapidAPI atteint.")
          : new ScraperError("http", `RapidAPI erreur ${response.status}.`);
      }
      if (response.status === 404) throw new ScraperError("not_found", "Publication introuvable.");
      if (!response.ok) throw new ScraperError("http", `RapidAPI erreur ${response.status}.`);
      return ((await response.json().catch(() => ({}))) || {}) as Record<string, unknown>;
    }
  }

  async function getGroupId(groupUrl: string): Promise<string> {
    const direct = groupIdFromUrl(groupUrl);
    if (direct) return direct;
    const cached = groupIdCache.get(groupUrl);
    if (cached) return cached;
    const data = await call("group/id", { url: groupUrl });
    const id = String(data.group_id ?? data.id ?? "").trim();
    if (!/^\d+$/.test(id)) throw new ScraperError("not_found", "Groupe introuvable : vérifiez l'adresse (seuls les groupes publics sont lisibles).");
    groupIdCache.set(groupUrl, id);
    return id;
  }

  async function getGroupPosts(groupId: string, opts: { cursor?: string | null; sortingOrder?: string } = {}) {
    const data = await call("group/posts", {
      group_id: groupId,
      cursor: opts.cursor || undefined,
      sorting_order: opts.sortingOrder || "CHRONOLOGICAL",
    });
    const posts = (Array.isArray(data.posts) ? data.posts : []) as ScraperPost[];
    const cursor = typeof data.cursor === "string" && data.cursor ? data.cursor : null;
    return { posts, cursor };
  }

  /** Relit une seule publication (1 appel). Renvoie null si l'API ne la trouve pas. */
  async function getPost(postId: string): Promise<ScraperPost | null> {
    try {
      const data = await call("post", { post_id: postId });
      const post = (data.results ?? data.post ?? null) as ScraperPost | null;
      return post && typeof post === "object" && !Array.isArray(post) ? post : null;
    } catch (error) {
      if (error instanceof ScraperError && error.code === "not_found") return null;
      throw error;
    }
  }

  async function fetchRecentPosts(groupUrl: string, limits: FetchLimits = {}) {
    const maxPages = limits.maxPages ?? 5;
    const maxPosts = limits.maxPosts ?? 50;
    const groupId = await getGroupId(groupUrl);
    const posts: ScraperPost[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages && posts.length < maxPosts; page++) {
      const result = await getGroupPosts(groupId, { cursor });
      let tooOld = false;
      for (const post of result.posts) {
        if (limits.since && typeof post.timestamp === "number" && post.timestamp < limits.since) {
          tooOld = true;
          continue;
        }
        if (posts.length < maxPosts) posts.push(post);
      }
      cursor = result.cursor;
      if (!cursor || tooOld) break;
    }
    return { groupId, posts };
  }

  return { getGroupId, getGroupPosts, getPost, fetchRecentPosts, requestsUsed: () => requestsUsed };
}

export type Scraper = ReturnType<typeof createScraper>;

// ---------- Plafond mensuel ----------

export interface RapidUsage {
  month: string;
  calls: number;
  day: string;
  autoCalls: number;
}

/** Plafond d'appels par mois (laisse une marge sous les 100 du forfait BASIC). */
export function monthlyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.RAPIDAPI_MONTHLY_CAP);
  return Number.isInteger(n) && n > 0 ? n : 90;
}

/** Vérifications automatiques par jour. */
export function autoPerDay(env: Record<string, string | undefined> = process.env): number {
  const raw = env.RAPIDAPI_AUTO_PER_DAY;
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isInteger(n) && n >= 0 ? n : 2;
}

/** Compteur remis à zéro au changement de mois (et de jour pour l'automatique), en UTC. */
export function normalizeUsage(raw: unknown, now = new Date()): RapidUsage {
  const month = now.toISOString().slice(0, 7);
  const day = now.toISOString().slice(0, 10);
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<RapidUsage>;
  return {
    month,
    calls: value.month === month && typeof value.calls === "number" ? value.calls : 0,
    day,
    autoCalls: value.day === day && typeof value.autoCalls === "number" ? value.autoCalls : 0,
  };
}

export async function readUsage(client: Client): Promise<RapidUsage> {
  const { data } = await client.from("wa_settings").select("value").eq("key", USAGE_KEY).maybeSingle();
  return normalizeUsage(data?.value);
}

/**
 * Compte un appel avant de l'envoyer ; refuse au-delà du plafond mensuel (ou du quota automatique du jour).
 *
 * @example const scraper = createScraper({ beforeRequest: () => reserveCall(service, { auto: true }) })
 */
export async function reserveCall(client: Client, opts: { auto?: boolean } = {}): Promise<void> {
  const usage = await readUsage(client);
  if (usage.calls >= monthlyCap()) throw new ScraperError("budget", `Plafond RapidAPI du mois atteint (${monthlyCap()} appels).`);
  if (opts.auto && usage.autoCalls >= autoPerDay()) throw new ScraperError("budget", "Vérifications automatiques du jour déjà faites.");
  const next: RapidUsage = { ...usage, calls: usage.calls + 1, autoCalls: usage.autoCalls + (opts.auto ? 1 : 0) };
  await client.from("wa_settings").upsert({ key: USAGE_KEY, value: next, updated_at: new Date().toISOString() });
}
