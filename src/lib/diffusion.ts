// Diffusion multicanal : règles de calcul PURES (aucune base, aucun réseau).
// Spécification : docs/prompts/diffusion-mi-casa-gabon.md. Une campagne relie un groupe WhatsApp
// à une sélection de quartiers et publie, aux heures choisies, deux flux indépendants :
// les annonces du quartier suivant (« products ») et les visuels de la médiathèque (« announcements »).

import { ALERT_TIMEZONE } from "./matching";

export const MAX_DRIP_SLOTS = 12;
export const DRIP_CHANNELS = ["group", "status", "channel", "facebook", "instagram"] as const;
export type DripChannel = (typeof DRIP_CHANNELS)[number];
export type DripChannels = Record<DripChannel, boolean>;
export type DripFlux = "products" | "announcements";

export const PER_CHANNEL_KEYS = ["status", "channel", "facebook", "facebook_posts", "instagram", "instagram_posts"] as const;
export type PerChannelKey = (typeof PER_CHANNEL_KEYS)[number];

export const DEFAULT_PRODUCT_HOURS = [9, 12, 15, 18, 21];
export const DEFAULT_MEDIA_HOURS = [10];
/** Au-delà de 5 annonces par créneau dans un groupe, c'est du spam. */
export const DRIP_MAX_PER_CATEGORY = 5;
export const MAX_MEDIA_ITEMS = 60;
export const MEDIA_CAPTION_MAX = 1000;
export const MEDIA_KEY = "diffusion_media";

export function dripSettingKey(slot: number): string {
  return `diffusion:${slot}`;
}
/** Nom du « rituel » au journal (playbook_log). */
export function dripRitual(slot: number): string {
  return `diffusion:${slot}`;
}
export function parseDripSlot(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_DRIP_SLOTS ? n : 1;
}
export function nextFreeDripSlot(configured: number[]): number | null {
  const used = new Set(configured);
  for (let s = 1; s <= MAX_DRIP_SLOTS; s++) if (!used.has(s)) return s;
  return null;
}

export interface DripConfig {
  enabled: boolean;
  name: string | null;
  /** Quartiers diffusés ; vide = tous les quartiers ayant des annonces publiables. */
  quartiers: string[];
  group_id: string | null;
  channel_id: string | null;
  // Flux « annonces par quartier »
  products_enabled: boolean;
  product_hours: number[];
  products_channels: DripChannels;
  per_category: number;
  per_hour_other: number;
  per_channel: Partial<Record<PerChannelKey, number>>;
  cursor: number;
  last_run_at: string | null;
  last_item_id: string | null;
  // Flux « médiathèque »
  announcements_enabled: boolean;
  media_hours: number[];
  media_scope: "all" | "selected";
  media_ids: string[];
  media_cursor: number;
  media_batch: number;
  announce_channels: DripChannels;
  announce_posts: { facebook: boolean; instagram: boolean };
  media_last_run_at: string | null;
  media_last_item_id: string | null;
}

const GROUP_ONLY: DripChannels = { group: true, status: false, channel: false, facebook: false, instagram: false };

export const DEFAULT_DRIP_CONFIG: DripConfig = {
  enabled: false,
  name: null,
  quartiers: [],
  group_id: null,
  channel_id: null,
  products_enabled: true,
  product_hours: DEFAULT_PRODUCT_HOURS,
  products_channels: GROUP_ONLY,
  per_category: 3,
  per_hour_other: 1,
  per_channel: {},
  cursor: 0,
  last_run_at: null,
  last_item_id: null,
  announcements_enabled: false,
  media_hours: DEFAULT_MEDIA_HOURS,
  media_scope: "selected",
  media_ids: [],
  media_cursor: 0,
  media_batch: 0,
  announce_channels: GROUP_ONLY,
  announce_posts: { facebook: true, instagram: true },
  media_last_run_at: null,
  media_last_item_id: null,
};

export const GROUP_ID_PATTERN = /^[\d-]{10,31}@g\.us$/;
export const CHANNEL_ID_PATTERN = /^[\d-]{10,31}@newsletter$/;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const int = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
};
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const isoOrNull = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** Heures pleines 0–23, uniques et triées ; liste vide → valeur par défaut. */
export function normalizeHours(v: unknown, fallback: number[]): number[] {
  const list = Array.isArray(v) ? v : [];
  const hours = Array.from(new Set(list.map((h) => Number(h)).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))).sort((a, b) => a - b);
  return hours.length ? hours : [...fallback];
}

export function normalizeChannels(v: unknown, fallback: DripChannels = GROUP_ONLY): DripChannels {
  const o = obj(v);
  return Object.fromEntries(DRIP_CHANNELS.map((c) => [c, bool(o[c], fallback[c])])) as DripChannels;
}

/** Fusion champ par champ : on peut cocher Instagram sans renvoyer les autres canaux. */
export function mergeChannels(current: DripChannels, patch: unknown): DripChannels {
  const o = obj(patch);
  return Object.fromEntries(DRIP_CHANNELS.map((c) => [c, typeof o[c] === "boolean" ? (o[c] as boolean) : current[c]])) as DripChannels;
}

/**
 * Configuration lisible quelle que soit la forme stockée : champs absents, types faux, nombres
 * hors bornes, heures en double. Ne lève jamais. Toute lecture ET toute écriture passent par elle.
 */
export function normalizeDripConfig(raw: unknown): DripConfig {
  const o = obj(raw);
  const perChannel: Partial<Record<PerChannelKey, number>> = {};
  const pc = obj(o.per_channel);
  for (const k of PER_CHANNEL_KEYS) {
    if (pc[k] === undefined || pc[k] === null) continue;
    const min = k.endsWith("_posts") ? 0 : 1;
    perChannel[k] = int(pc[k], min, min, DRIP_MAX_PER_CATEGORY);
  }
  const posts = obj(o.announce_posts);
  const group = str(o.group_id, 40);
  const channel = str(o.channel_id, 40);
  const quartiers = Array.isArray(o.quartiers)
    ? Array.from(new Set(o.quartiers.filter((q): q is string => typeof q === "string" && !!q.trim()).map((q) => q.trim().slice(0, 60))))
    : [];
  const mediaIds = Array.isArray(o.media_ids) ? Array.from(new Set(o.media_ids.filter((m): m is string => typeof m === "string"))) : [];
  return {
    enabled: bool(o.enabled, DEFAULT_DRIP_CONFIG.enabled),
    name: str(o.name, 60),
    quartiers,
    group_id: group && GROUP_ID_PATTERN.test(group) ? group : null,
    channel_id: channel && CHANNEL_ID_PATTERN.test(channel) ? channel : null,
    products_enabled: bool(o.products_enabled, DEFAULT_DRIP_CONFIG.products_enabled),
    product_hours: normalizeHours(o.product_hours, DEFAULT_PRODUCT_HOURS),
    products_channels: normalizeChannels(o.products_channels),
    per_category: int(o.per_category, DEFAULT_DRIP_CONFIG.per_category, 1, DRIP_MAX_PER_CATEGORY),
    per_hour_other: int(o.per_hour_other, DEFAULT_DRIP_CONFIG.per_hour_other, 1, DRIP_MAX_PER_CATEGORY),
    per_channel: perChannel,
    cursor: int(o.cursor, 0, 0, 1_000_000),
    last_run_at: isoOrNull(o.last_run_at),
    last_item_id: str(o.last_item_id, 120),
    announcements_enabled: bool(o.announcements_enabled, DEFAULT_DRIP_CONFIG.announcements_enabled),
    media_hours: normalizeHours(o.media_hours, DEFAULT_MEDIA_HOURS),
    media_scope: o.media_scope === "all" || o.media_scope === "selected" ? o.media_scope : mediaIds.length ? "selected" : "all",
    media_ids: mediaIds,
    media_cursor: int(o.media_cursor, 0, 0, 1_000_000),
    media_batch: int(o.media_batch, 0, 0, MAX_MEDIA_ITEMS),
    announce_channels: normalizeChannels(o.announce_channels),
    announce_posts: { facebook: bool(posts.facebook, true), instagram: bool(posts.instagram, true) },
    media_last_run_at: isoOrNull(o.media_last_run_at),
    media_last_item_id: str(o.media_last_item_id, 120),
  };
}

// ---------- Rythmes ----------

export function productsFor(cfg: DripConfig, channel: DripChannel): number {
  if (channel === "group") return cfg.per_category;
  return cfg.per_channel[channel as PerChannelKey] ?? cfg.per_hour_other;
}
export const facebookPostsFor = (cfg: DripConfig) => cfg.per_channel.facebook_posts ?? 1;
export const instagramPostsFor = (cfg: DripConfig) => cfg.per_channel.instagram_posts ?? 1;
export function maxProductsPerHour(cfg: DripConfig): number {
  return Math.max(cfg.per_category, cfg.per_hour_other, ...Object.values(cfg.per_channel).map((n) => n ?? 0));
}

// ---------- Heure locale et verrou ----------

function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("fr-FR", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  // PIÈGE : certains moteurs rendent minuit « 24 ».
  return { day: `${map.year}-${map.month}-${map.day}`, hour: Number(map.hour) % 24 };
}
export const localHour = (d: Date, tz = ALERT_TIMEZONE) => parts(d, tz).hour;
export const localHourKey = (d: Date, tz = ALERT_TIMEZONE) => {
  const p = parts(d, tz);
  return `${p.day}-${String(p.hour).padStart(2, "0")}`;
};
export function alreadyRanThisHour(lastRunAt: string | null, now: Date): boolean {
  if (!lastRunAt) return false;
  const last = new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) return false;
  return localHourKey(last) === localHourKey(now);
}

// ---------- Annonces par quartier ----------

export interface DiffusionAnnonce {
  id: string;
  quartier: string | null;
  type_offre: string | null;
  type_bien: string | null;
  prix: number | null;
  devise?: string | null;
  nb_chambres: number | null;
  meuble: boolean | null;
  photo: string | null;
  /** Date de référence (publication, sinon collecte), ISO. */
  date: string | null;
}

export interface QuartierGroup {
  quartier: string;
  annonces: DiffusionAnnonce[];
}

/** Quartiers publiables (au moins une annonce avec prix et photo), du plus fourni au moins fourni. */
export function publishableQuartiers(annonces: DiffusionAnnonce[], selected: string[]): QuartierGroup[] {
  const wanted = new Set(selected.map((q) => q.toLowerCase()));
  const groups = new Map<string, QuartierGroup>();
  for (const a of annonces) {
    if (!a.quartier || !a.prix || a.prix <= 0 || !a.photo) continue;
    if (wanted.size && !wanted.has(a.quartier.toLowerCase())) continue;
    const g = groups.get(a.quartier) ?? { quartier: a.quartier, annonces: [] };
    g.annonces.push(a);
    groups.set(a.quartier, g);
  }
  for (const g of Array.from(groups.values())) g.annonces.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
  return Array.from(groups.values()).sort((a, b) => b.annonces.length - a.annonces.length || a.quartier.localeCompare(b.quartier, "fr"));
}

export function pickIndex(cursor: number, total: number): number {
  if (total <= 0) return -1;
  return ((cursor % total) + total) % total;
}

const TYPE_LABELS: Record<string, string> = {
  appartement: "Appartement",
  maison: "Maison",
  studio: "Studio",
  villa: "Villa",
  chambre: "Chambre",
  terrain: "Terrain",
  bureau: "Bureau",
  commerce: "Local commercial",
  duplex: "Duplex",
};
const OFFRE_LABELS: Record<string, string> = { location: "à louer", vente: "à vendre", colocation: "en colocation" };

export function formatFcfa(n: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(n).replace(/ | /g, " ")} FCFA`;
}

/** WhatsApp accepte *gras* et _italique_ ; Facebook et Instagram non. */
export function stripMarkup(text: string): string {
  return text.replace(/[*_]/g, "");
}

export function signupLink(baseUrl: string, source: DripChannel | "media", slot: number): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/signup?utm_source=${source}&utm_medium=diffusion&utm_campaign=diffusion-${slot}`;
}

function annonceLines(a: DiffusionAnnonce): string[] {
  const type = TYPE_LABELS[a.type_bien || ""] || "Bien";
  const offre = OFFRE_LABELS[a.type_offre || ""] || "";
  const title = `🏠 *${[type, a.nb_chambres ? `${a.nb_chambres} ch.` : null, offre].filter(Boolean).join(" ")}* — ${a.quartier}`;
  const price = a.prix ? `💰 ${formatFcfa(a.prix)}${a.type_offre === "location" ? " / mois" : ""}` : null;
  return [title, price, a.meuble ? "🛋️ Meublé" : null].filter((l): l is string => !!l);
}

export interface DripPlan {
  index: number;
  total: number;
  itemId: string;
  quartier: string;
  header: string;
  products: Array<{ id: string; imageUrl: string; caption: string; social: string; url: string }>;
  tagline: string;
}

/**
 * Plan du prochain créneau « annonces par quartier » : quartier choisi par le curseur, en-tête,
 * puis `maxProductsPerHour` annonces (chaque canal en prend sa part).
 */
export function buildDripPlan(groups: QuartierGroup[], cfg: DripConfig, baseUrl: string, slot: number): DripPlan | null {
  const index = pickIndex(cfg.cursor, groups.length);
  if (index < 0) return null;
  const g = groups[index];
  const picked = g.annonces.slice(0, maxProductsPerHour(cfg));
  const tagline = "Recevez les annonces de votre quartier directement sur WhatsApp.";
  const header = [
    `🏠 *Nouvelles annonces à ${g.quartier}*`,
    `_${g.annonces.length} annonce${g.annonces.length > 1 ? "s" : ""} de moins de 60 h_`,
    `Mi Casa Gabon : ${tagline}`,
  ].join("\n\n");
  return {
    index,
    total: groups.length,
    itemId: g.quartier,
    quartier: g.quartier,
    header,
    tagline,
    products: picked.map((a) => {
      const url = signupLink(baseUrl, "group", slot);
      const lines = annonceLines(a);
      const caption = [...lines, "", `👉 Toutes les annonces et le contact : ${url}`].join("\n");
      // PIÈGE : on retire la mise en forme du texte seulement — le lien contient « utm_… ».
      const social = `${stripMarkup([...lines, "", tagline].join("\n"))}\n👉 ${signupLink(baseUrl, "facebook", slot)}`;
      return { id: a.id, imageUrl: a.photo as string, caption, social, url };
    }),
  };
}

// ---------- Médiathèque ----------

export interface MediaItem {
  id: string;
  url: string;
  kind: "image" | "video";
  title: string;
  caption: string;
  active: boolean;
  created_at: string;
}

export function mediaKindFromUrl(url: string): "image" | "video" {
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url) ? "video" : "image";
}

export function normalizeMedia(raw: unknown): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MediaItem[] = [];
  for (const r of raw) {
    const o = obj(r);
    const url = typeof o.url === "string" && /^https?:\/\//.test(o.url) ? o.url : null;
    const id = typeof o.id === "string" ? o.id : null;
    if (!url || !id) continue;
    out.push({
      id,
      url,
      kind: o.kind === "video" || o.kind === "image" ? o.kind : mediaKindFromUrl(url),
      title: (typeof o.title === "string" ? o.title : "").slice(0, 80),
      caption: (typeof o.caption === "string" ? o.caption : "").slice(0, MEDIA_CAPTION_MAX),
      active: bool(o.active, true),
      created_at: isoOrNull(o.created_at) ?? new Date(0).toISOString(),
    });
  }
  return out.slice(0, MAX_MEDIA_ITEMS);
}

export function campaignMedia(items: MediaItem[], cfg: DripConfig): MediaItem[] {
  const active = items.filter((m) => m.active);
  if (cfg.media_scope === "all") return active;
  const wanted = new Set(cfg.media_ids);
  return active.filter((m) => wanted.has(m.id));
}

export interface MediaPlan {
  index: number;
  total: number;
  item: MediaItem;
  caption: string;
}

/** Légende finale : légende du média, rappel du service, lien — parties absentes omises. */
export function finalCaption(item: MediaItem, link: string, tagline = "🏠 Mi Casa Gabon : les annonces de votre quartier sur WhatsApp."): string {
  return [item.caption.trim(), tagline, link ? `👉 ${link}` : ""].filter(Boolean).join("\n\n");
}

export function buildMediaBatch(items: MediaItem[], cfg: DripConfig, link: string): MediaPlan[] {
  const pool = campaignMedia(items, cfg);
  if (!pool.length) return [];
  if (!cfg.media_batch || cfg.media_batch >= pool.length) {
    return pool.map((item, index) => ({ index, total: pool.length, item, caption: finalCaption(item, link) }));
  }
  const start = pickIndex(cfg.media_cursor, pool.length);
  return Array.from({ length: cfg.media_batch }, (_, i) => {
    const index = (start + i) % pool.length;
    return { index, total: pool.length, item: pool[index], caption: finalCaption(pool[index], link) };
  });
}

/** Nombre d'annonces de la médiathèque publiées à chaque créneau. */
export function announcementsPerSlot(items: MediaItem[], cfg: DripConfig): number {
  const pool = campaignMedia(items, cfg).length;
  if (!pool) return 0;
  return !cfg.media_batch || cfg.media_batch >= pool ? pool : cfg.media_batch;
}

// ---------- Volume quotidien ----------

export function dailyVolume(cfg: DripConfig, perSlotAnnouncements: number): Record<DripChannel, number> {
  const out: Record<DripChannel, number> = { group: 0, status: 0, channel: 0, facebook: 0, instagram: 0 };
  if (cfg.enabled && cfg.products_enabled) {
    const n = cfg.product_hours.length;
    const ch = cfg.products_channels;
    // En-tête + annonces dans le groupe et la chaîne.
    if (ch.group) out.group += n * (cfg.per_category + 1);
    if (ch.status) out.status += n * productsFor(cfg, "status");
    if (ch.channel) out.channel += n * (productsFor(cfg, "channel") + 1);
    if (ch.facebook) {
      const s = productsFor(cfg, "facebook");
      out.facebook += n * (s + Math.min(s, facebookPostsFor(cfg)));
    }
    if (ch.instagram) {
      const s = productsFor(cfg, "instagram");
      out.instagram += n * (s + Math.min(s, instagramPostsFor(cfg)));
    }
  }
  if (cfg.enabled && cfg.announcements_enabled && perSlotAnnouncements > 0) {
    const per = cfg.media_hours.length * perSlotAnnouncements;
    const ch = cfg.announce_channels;
    if (ch.group) out.group += per;
    if (ch.status) out.status += per;
    if (ch.channel) out.channel += per;
    if (ch.facebook) out.facebook += per * (cfg.announce_posts.facebook ? 2 : 1);
    if (ch.instagram) out.instagram += per * (cfg.announce_posts.instagram ? 2 : 1);
  }
  return out;
}

// ---------- Bilan ----------

export interface ChannelReport {
  sent: number;
  errors: string[];
  skipped?: "disabled" | "not_configured";
}
export type BroadcastReport = Record<DripChannel, ChannelReport> & { whatsapp_status?: string };

export function emptyReport(): BroadcastReport {
  return Object.fromEntries(DRIP_CHANNELS.map((c) => [c, { sent: 0, errors: [] }])) as unknown as BroadcastReport;
}

const CHANNEL_LABELS: Record<DripChannel, string> = { group: "groupe", status: "statut", channel: "chaîne", facebook: "facebook", instagram: "instagram" };

/** Une ligne pour le journal : « groupe 4 · statut 3 · chaîne ⚙︎ · facebook 2 (1 err.) ». */
export function summarizeReport(report: BroadcastReport): string {
  return DRIP_CHANNELS.filter((c) => report[c].skipped !== "disabled")
    .map((c) => {
      const r = report[c];
      if (r.skipped === "not_configured") return `${CHANNEL_LABELS[c]} ⚙︎`;
      return `${CHANNEL_LABELS[c]} ${r.sent}${r.errors.length ? ` (${r.errors.length} err.)` : ""}`;
    })
    .join(" · ");
}

/** Nom affiché d'une campagne. */
export function campaignTitle(cfg: DripConfig, slot: number, groupName?: string | null): string {
  return cfg.name || groupName || (cfg.quartiers.length ? cfg.quartiers.slice(0, 3).join(", ") : null) || `Campagne ${slot}`;
}
