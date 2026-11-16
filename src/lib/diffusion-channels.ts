// Adaptateurs de canaux de la diffusion : WhatsApp (WAHA) et Meta (Facebook, Instagram).
// Chaque fonction renvoie { ok, error?, skipped? } et ne lève jamais : un canal qui échoue
// n'arrête pas les autres. Les erreurs sont lisibles et tronquées à 300 caractères.

import { extractMessageId, getWahaSession, isWahaConfigured, logSend, wahaFetch } from "./whatsapp";

export interface SendResult {
  ok: boolean;
  error?: string;
  skipped?: "not_configured";
}

const short = (text: string) => text.slice(0, 300);

// ---------------- WhatsApp (WAHA) ----------------

export interface WhatsAppHealth {
  ok: boolean;
  status: string;
}

/** Santé de la session WAHA : un seul état vaut « connecté », WORKING. */
export async function whatsappHealth(): Promise<WhatsAppHealth> {
  if (!isWahaConfigured()) return { ok: false, status: "NOT_CONFIGURED" };
  try {
    const res = await wahaFetch(`/api/sessions/${encodeURIComponent(getWahaSession())}`);
    if (res.status === 404) return { ok: false, status: "NO_SESSION" };
    if (!res.ok) return { ok: false, status: `HTTP_${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    const status = data.status || "UNKNOWN";
    return { ok: status === "WORKING", status };
  } catch {
    return { ok: false, status: "UNREACHABLE" };
  }
}

/** Phrase claire pour l'équipe, avec le geste à faire. */
export function whatsappDownMessage(status: string): string {
  if (status === "NOT_CONFIGURED") return "WhatsApp n'est pas configuré (WAHA_API_URL / WAHA_API_KEY sur Railway).";
  if (status === "SCAN_QR_CODE") return "Canal WhatsApp déconnecté : rescannez le QR code dans l'onglet WhatsApp.";
  if (status === "UNREACHABLE") return "Le serveur WhatsApp (WAHA) ne répond pas : vérifiez le service WAHA sur Railway.";
  return `Canal WhatsApp indisponible (statut ${status}) : ouvrez l'onglet WhatsApp pour le reconnecter.`;
}

export interface WaGroup {
  id: string;
  name: string;
  participantsCount: number | null;
}
export interface WaChannel {
  id: string;
  name: string;
  subscribers: number | null;
}

/** Groupes WhatsApp du numéro connecté. Formes de réponse variables selon le moteur WAHA. */
export async function listWhatsAppGroups(): Promise<WaGroup[] | null> {
  if (!isWahaConfigured()) return null;
  try {
    const res = await wahaFetch(`/api/${encodeURIComponent(getWahaSession())}/groups?limit=200`);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as unknown;
    const list: unknown[] = Array.isArray(data) ? data : data && typeof data === "object" ? Object.values(data as Record<string, unknown>) : [];
    const groups: WaGroup[] = [];
    for (const g of list) {
      if (!g || typeof g !== "object") continue;
      const o = g as Record<string, unknown>;
      const rawId = o.id;
      const id = typeof rawId === "string" ? rawId : rawId && typeof rawId === "object" ? String((rawId as Record<string, unknown>)._serialized ?? "") : "";
      if (!id.endsWith("@g.us")) continue;
      const meta = (o.groupMetadata || {}) as Record<string, unknown>;
      const name = String(o.subject ?? o.name ?? meta.subject ?? id);
      const participants = Array.isArray(o.participants) ? o.participants.length : typeof o.size === "number" ? o.size : null;
      groups.push({ id, name, participantsCount: participants });
    }
    return groups.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  } catch {
    return null;
  }
}

/** Chaînes WhatsApp (…@newsletter) dont le numéro connecté est administrateur. */
export async function listWhatsAppChannels(): Promise<WaChannel[] | null> {
  if (!isWahaConfigured()) return null;
  try {
    const res = await wahaFetch(`/api/${encodeURIComponent(getWahaSession())}/channels?role=OWNER`);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .map((c) => c as Record<string, unknown>)
      .filter((c) => typeof c.id === "string" && (c.id as string).endsWith("@newsletter"))
      .map((c) => ({ id: c.id as string, name: String(c.name ?? c.id), subscribers: typeof c.subscribersCount === "number" ? c.subscribersCount : null }));
  } catch {
    return null;
  }
}

async function wahaPost(path: string, body: Record<string, unknown>): Promise<SendResult> {
  if (!isWahaConfigured()) return { ok: false, skipped: "not_configured" };
  try {
    const res = await wahaFetch(path, { method: "POST", body: JSON.stringify(body) });
    const data: unknown = await res.json().catch(() => null);
    const result = res.ok
      ? { success: true, messageId: extractMessageId(data) }
      : { success: false, error: short(`WAHA ${res.status} : ${JSON.stringify(data ?? {}).slice(0, 200)}`) };
    // Compté dans le volume quotidien du tableau de bord (sans destinataire).
    await logSend(result);
    return result.success ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    await logSend({ success: false, error: "WAHA injoignable" });
    return { ok: false, error: short(`WAHA injoignable : ${error instanceof Error ? error.message : "erreur"}`) };
  }
}

const mimeOf = (url: string, kind: "image" | "video") =>
  kind === "video" ? "video/mp4" : /\.png(\?|$)/i.test(url) ? "image/png" : /\.webp(\?|$)/i.test(url) ? "image/webp" : "image/jpeg";

/** Texte vers un groupe (…@g.us) ou une chaîne (…@newsletter). */
export function waSendText(chatId: string, text: string): Promise<SendResult> {
  return wahaPost("/api/sendText", { session: getWahaSession(), chatId, text });
}

/** Image ou vidéo légendée vers un groupe ou une chaîne. */
export function waSendMedia(chatId: string, url: string, kind: "image" | "video", caption: string): Promise<SendResult> {
  const file: Record<string, string> = { url, mimetype: mimeOf(url, kind) };
  if (kind === "video") file.filename = "video.mp4";
  return wahaPost(kind === "video" ? "/api/sendVideo" : "/api/sendImage", { session: getWahaSession(), chatId, caption, file });
}

/** Statut WhatsApp (story) image ou vidéo, visible par les contacts. */
export function waSendStatus(url: string, kind: "image" | "video", caption: string): Promise<SendResult> {
  const session = encodeURIComponent(getWahaSession());
  return wahaPost(`/api/${session}/status/${kind}`, { file: { url, mimetype: mimeOf(url, kind) }, caption });
}

// ---------------- Meta (Facebook, Instagram) ----------------

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;
export const metaFacebookConfigured = () => !!(process.env.META_PAGE_ID && process.env.META_PAGE_TOKEN);
export const metaInstagramConfigured = () => !!(process.env.META_IG_USER_ID && process.env.META_PAGE_TOKEN);

async function graph(path: string, params: Record<string, unknown>, method: "POST" | "GET" = "POST"): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  const token = process.env.META_PAGE_TOKEN as string;
  try {
    const url = new URL(`${GRAPH()}${path}`);
    let init: RequestInit = { method, signal: AbortSignal.timeout(60_000) };
    if (method === "GET") {
      for (const [k, v] of Object.entries({ ...params, access_token: token })) url.searchParams.set(k, String(v));
    } else {
      init = { ...init, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...params, access_token: token }) };
    }
    const res = await fetch(url, init);
    const data = ((await res.json().catch(() => ({}))) || {}) as Record<string, unknown>;
    if (!res.ok || data.error) {
      const err = (data.error || {}) as Record<string, unknown>;
      return { ok: false, data, error: short(`Graph ${res.status} : ${String(err.message ?? "erreur")} (code ${String(err.code ?? "?")})`) };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, data: {}, error: short(`Graph injoignable : ${error instanceof Error ? error.message : "erreur"}`) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Publication Facebook (photo ou vidéo) sur la Page. */
export async function fbPost(url: string, kind: "image" | "video", message: string): Promise<SendResult> {
  if (!metaFacebookConfigured()) return { ok: false, skipped: "not_configured" };
  const page = process.env.META_PAGE_ID;
  const r = kind === "video" ? await graph(`/${page}/videos`, { file_url: url, description: message }) : await graph(`/${page}/photos`, { url, message });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Story Facebook (photo ou vidéo) sur la Page. */
export async function fbStory(url: string, kind: "image" | "video"): Promise<SendResult> {
  if (!metaFacebookConfigured()) return { ok: false, skipped: "not_configured" };
  const page = process.env.META_PAGE_ID;
  const token = process.env.META_PAGE_TOKEN as string;
  if (kind === "image") {
    const photo = await graph(`/${page}/photos`, { url, published: false });
    if (!photo.ok) return { ok: false, error: photo.error };
    const story = await graph(`/${page}/photo_stories`, { photo_id: photo.data.id });
    return story.ok ? { ok: true } : { ok: false, error: story.error };
  }
  const start = await graph(`/${page}/video_stories`, { upload_phase: "start" });
  if (!start.ok) return { ok: false, error: start.error };
  const videoId = String(start.data.video_id ?? "");
  const uploadUrl = String(start.data.upload_url ?? "");
  try {
    const up = await fetch(uploadUrl, { method: "POST", headers: { Authorization: `OAuth ${token}`, file_url: url }, signal: AbortSignal.timeout(120_000) });
    if (!up.ok) return { ok: false, error: short(`Envoi de la vidéo refusé (${up.status})`) };
  } catch {
    return { ok: false, error: "Envoi de la vidéo vers Facebook impossible" };
  }
  // Attendre la fin du traitement (2 min au plus).
  for (let i = 0; i < 40; i++) {
    const st = await graph(`/${videoId}`, { fields: "status" }, "GET");
    const status = (st.data.status || {}) as Record<string, unknown>;
    const upload = ((status.uploading_phase || {}) as Record<string, unknown>).status;
    const processing = ((status.processing_phase || {}) as Record<string, unknown>).status;
    if (upload === "complete" && processing === "complete") break;
    if (processing === "error") return { ok: false, error: "Facebook a refusé la vidéo (traitement en erreur)" };
    await sleep(3000);
  }
  const finish = await graph(`/${page}/video_stories`, { upload_phase: "finish", video_id: videoId });
  return finish.ok ? { ok: true } : { ok: false, error: finish.error };
}

/**
 * Instagram : conteneur, attente obligatoire de FINISHED, puis publication.
 * PIÈGE : publier avant FINISHED renvoie « Media ID is not available (9007) ».
 */
async function igPublish(params: Record<string, unknown>, isVideo: boolean): Promise<SendResult> {
  if (!metaInstagramConfigured()) return { ok: false, skipped: "not_configured" };
  const ig = process.env.META_IG_USER_ID;
  const container = await graph(`/${ig}/media`, params);
  if (!container.ok) return { ok: false, error: container.error };
  const id = String(container.data.id ?? "");
  const deadline = Date.now() + (isVideo ? 180_000 : 45_000);
  for (;;) {
    const st = await graph(`/${id}`, { fields: "status_code,status" }, "GET");
    const code = String(st.data.status_code ?? "");
    if (code === "FINISHED") break;
    if (code === "ERROR" || code === "EXPIRED") return { ok: false, error: short(`Instagram a refusé le média (${code} : ${String(st.data.status ?? "")})`) };
    if (Date.now() > deadline) return { ok: false, error: "Instagram n'a pas fini de traiter le média à temps" };
    await sleep(3000);
  }
  const pub = await graph(`/${ig}/media_publish`, { creation_id: id });
  return pub.ok ? { ok: true } : { ok: false, error: pub.error };
}

export function igPost(url: string, kind: "image" | "video", caption: string): Promise<SendResult> {
  return kind === "video" ? igPublish({ video_url: url, media_type: "REELS", caption }, true) : igPublish({ image_url: url, caption }, false);
}

export function igStory(url: string, kind: "image" | "video"): Promise<SendResult> {
  return kind === "video" ? igPublish({ video_url: url, media_type: "STORIES" }, true) : igPublish({ image_url: url, media_type: "STORIES" }, false);
}
