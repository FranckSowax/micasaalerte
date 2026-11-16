// Moteur de la diffusion : lecture / écriture des campagnes, plan, verrou atomique, envoi par
// canal, alerte et journal. Un seul chemin d'exécution pour le cron et le bouton « Publier ».

import { fetchAllowedAgentIds } from "./agent-access";
import { annonceDate, isExpired } from "./annonce-lifetime";
import { publicBaseUrl } from "./client-access";
import {
  alreadyRanThisHour,
  buildDripPlan,
  buildMediaBatch,
  dripRitual,
  dripSettingKey,
  emptyReport,
  facebookPostsFor,
  instagramPostsFor,
  localHour,
  MAX_DRIP_SLOTS,
  MEDIA_KEY,
  normalizeDripConfig,
  normalizeMedia,
  productsFor,
  publishableQuartiers,
  signupLink,
  stripMarkup,
  summarizeReport,
  type BroadcastReport,
  type DiffusionAnnonce,
  type DripChannel,
  type DripConfig,
  type DripFlux,
  type MediaItem,
  type QuartierGroup,
} from "./diffusion";
import { fbPost, fbStory, igPost, igStory, waSendMedia, waSendStatus, waSendText, whatsappDownMessage, whatsappHealth, type SendResult } from "./diffusion-channels";
import { isStoredPhoto } from "./photos";
import type { createServiceClient } from "./supabase/server";
import { sendWhatsAppMessage } from "./whatsapp";

type Client = ReturnType<typeof createServiceClient>;

/** Pause entre deux messages WhatsApp : c'est elle qui évite le bannissement. Ne pas raccourcir. */
const WA_PAUSE_MS = 1500;
/** Pause entre deux annonces de la médiathèque d'un même créneau. */
const MEDIA_PAUSE_MS = 4000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- Stockage ----------------

/** Les tables de la diffusion existent-elles ? (script SQL lancé à la main) */
export async function diffusionInstalled(client: Client): Promise<boolean> {
  const { error } = await client.from("wa_settings").select("key").limit(1);
  return !error;
}

export async function readCampaign(client: Client, slot: number): Promise<DripConfig | null> {
  const { data } = await client.from("wa_settings").select("value").eq("key", dripSettingKey(slot)).maybeSingle();
  return data ? normalizeDripConfig(data.value) : null;
}

export async function listCampaigns(client: Client): Promise<{ slot: number; config: DripConfig }[]> {
  const keys = Array.from({ length: MAX_DRIP_SLOTS }, (_, i) => dripSettingKey(i + 1));
  const { data } = await client.from("wa_settings").select("key, value").in("key", keys);
  return (data || [])
    .map((row) => ({ slot: Number(String(row.key).split(":")[1]), config: normalizeDripConfig(row.value) }))
    .filter((c) => Number.isInteger(c.slot))
    .sort((a, b) => a.slot - b.slot);
}

export async function saveCampaign(client: Client, slot: number, config: DripConfig): Promise<string | null> {
  const { error } = await client.from("wa_settings").upsert({ key: dripSettingKey(slot), value: normalizeDripConfig(config), updated_at: new Date().toISOString() });
  return error ? error.message : null;
}

export async function deleteCampaign(client: Client, slot: number): Promise<void> {
  await client.from("wa_settings").delete().eq("key", dripSettingKey(slot));
}

export async function readMedia(client: Client): Promise<MediaItem[]> {
  const { data } = await client.from("wa_settings").select("value").eq("key", MEDIA_KEY).maybeSingle();
  return normalizeMedia(data?.value);
}

export async function saveMedia(client: Client, items: MediaItem[]): Promise<string | null> {
  const { error } = await client.from("wa_settings").upsert({ key: MEDIA_KEY, value: normalizeMedia(items), updated_at: new Date().toISOString() });
  return error ? error.message : null;
}

export async function journal(client: Client, slot: number, note: string, actor: string): Promise<void> {
  await client.from("playbook_log").insert({ ritual: dripRitual(slot), note: note.slice(0, 500), done_by: actor });
}

export async function recentJournal(client: Client, slot: number, limit = 24) {
  const { data } = await client.from("playbook_log").select("note, done_by, done_at").eq("ritual", dripRitual(slot)).order("done_at", { ascending: false }).limit(limit);
  return data || [];
}

// ---------------- Annonces publiables ----------------

/** Annonces des agents autorisés, de moins de 60 h, avec leur première photo copiée dans notre stockage. */
export async function loadDiffusionAnnonces(client: Client, now = new Date()): Promise<DiffusionAnnonce[]> {
  const allowed = await fetchAllowedAgentIds();
  if (!allowed?.size) return [];
  const since = new Date(now.getTime() - 4 * 86_400_000).toISOString();
  const { data } = await client
    .from("annonces")
    .select("id, user_id, quartier, type_offre, type_bien, prix, devise, nb_chambres, meuble, raw_images, fb_posted_at, created_at, status")
    .in("user_id", Array.from(allowed))
    .eq("ai_is_real_estate", true)
    .neq("status", "archived")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(400);
  return (data || [])
    .filter((a) => !isExpired(a as { fb_posted_at: string | null; created_at: string | null }, now))
    .map((a) => {
      const photos = Array.isArray(a.raw_images) ? (a.raw_images as string[]) : [];
      const date = annonceDate(a as { fb_posted_at: string | null; created_at: string | null });
      return {
        id: a.id as string,
        quartier: (a.quartier as string | null) ?? null,
        type_offre: (a.type_offre as string | null) ?? null,
        type_bien: (a.type_bien as string | null) ?? null,
        prix: typeof a.prix === "number" ? a.prix : null,
        devise: (a.devise as string | null) ?? null,
        nb_chambres: typeof a.nb_chambres === "number" ? a.nb_chambres : null,
        meuble: typeof a.meuble === "boolean" ? a.meuble : null,
        // PIÈGE : Meta et WAHA téléchargent l'image eux-mêmes ; seul un lien public et permanent fonctionne.
        photo: photos.find((p) => isStoredPhoto(p)) ?? null,
        date: date ? new Date(date).toISOString() : null,
      };
    });
}

export async function quartierGroups(client: Client, cfg: DripConfig): Promise<QuartierGroup[]> {
  return publishableQuartiers(await loadDiffusionAnnonces(client), cfg.quartiers);
}

// ---------------- Verrou atomique ----------------

/**
 * PIÈGE CAPITAL : le verrou se prend AVANT l'envoi, par une mise à jour conditionnelle sur
 * l'ancienne valeur. Deux déclenchements simultanés : un seul gagne, l'autre ne publie rien.
 */
export async function claimFlux(client: Client, flux: DripFlux, slot: number, seen: string | null, now: Date, itemId: string, step = 1): Promise<boolean> {
  const key = dripSettingKey(slot);
  const path = flux === "products" ? "last_run_at" : "media_last_run_at";
  const { data: row } = await client.from("wa_settings").select("value").eq("key", key).maybeSingle();
  if (!row) return false;
  const current = (row.value as Record<string, unknown> | null)?.[path];
  if ((typeof current === "string" ? current : null) !== seen) return false;
  const fresh = normalizeDripConfig(row.value);
  const next: DripConfig =
    flux === "products"
      ? { ...fresh, cursor: fresh.cursor + 1, last_run_at: now.toISOString(), last_item_id: itemId }
      : { ...fresh, media_cursor: fresh.media_cursor + step, media_last_run_at: now.toISOString(), media_last_item_id: itemId };
  let q = client.from("wa_settings").update({ value: next, updated_at: now.toISOString() }).eq("key", key);
  q = seen ? q.filter(`value->>${path}`, "eq", seen) : q.is(`value->>${path}`, null);
  const { data, error } = await q.select("key");
  return !error && (data || []).length === 1;
}

// ---------------- Diffusion ----------------

interface Ctx {
  report: BroadcastReport;
  waOk: boolean;
}

function record(ctx: Ctx, channel: DripChannel, r: SendResult, label?: string) {
  const rep = ctx.report[channel];
  if (r.ok) rep.sent++;
  else if (r.skipped === "not_configured") rep.skipped = "not_configured";
  else if (r.error) rep.errors.push(label ? `${label} : ${r.error}` : r.error);
}

async function waStep(ctx: Ctx, channel: "group" | "status" | "channel", send: () => Promise<SendResult>, label?: string) {
  if (!ctx.waOk) return;
  record(ctx, channel, await send(), label);
  await sleep(WA_PAUSE_MS);
}

/** Légende réseaux : mise en forme WhatsApp retirée du texte, jamais du lien (il contient « utm_ »). */
function socialCaption(caption: string): string {
  const at = caption.lastIndexOf("👉");
  return at < 0 ? stripMarkup(caption) : `${stripMarkup(caption.slice(0, at))}${caption.slice(at)}`;
}

let lastAlertAt = 0;
/** Alerte WhatsApp à l'agent (au plus une toutes les 3 heures par processus). */
async function alertAgent(client: Client, text: string): Promise<void> {
  if (Date.now() - lastAlertAt < 3 * 3_600_000) return;
  const allowed = await fetchAllowedAgentIds();
  if (!allowed?.size) return;
  const { data } = await client.from("profiles").select("whatsapp_phone").in("id", Array.from(allowed)).not("whatsapp_phone", "is", null).limit(1);
  const phone = data?.[0]?.whatsapp_phone as string | undefined;
  if (!phone) return;
  const sent = await sendWhatsAppMessage(phone, `*Mi Casa Gabon — Diffusion*\n\n${text}`);
  if (sent.success) lastAlertAt = Date.now();
}

export interface RunOptions {
  origin: "cron" | "admin";
  dry?: boolean;
  force?: boolean;
  /** false = test : publie sans avancer le curseur ni poser le verrou. */
  advance?: boolean;
  actor: string;
  slot: number;
  flux: DripFlux;
}

export type RunSkip =
  | "not_installed"
  | "missing"
  | "disabled"
  | "not_configured"
  | "not_scheduled"
  | "already_sent_this_hour"
  | "no_publishable_category"
  | "no_media";

export type RunResult = { skipped: RunSkip } | { dry: true; plan: unknown } | { sent: true; summary: string; report: BroadcastReport };

async function checkWhatsApp(client: Client, ctx: Ctx, cfg: DripConfig, needsWa: boolean, what: string, slot: number) {
  const health = await whatsappHealth();
  ctx.waOk = health.ok;
  ctx.report.whatsapp_status = health.status;
  if (needsWa && !health.ok) {
    const why = whatsappDownMessage(health.status);
    for (const c of ["group", "status", "channel"] as const) if (!ctx.report[c].skipped) ctx.report[c].errors.push(why);
    await alertAgent(client, `${why}\nCampagne ${slot}${cfg.name ? ` (${cfg.name})` : ""} : ${what} ne sont pas parties sur WhatsApp.`);
  }
}

export async function runFlux(client: Client, opts: RunOptions, now = new Date()): Promise<RunResult> {
  const cfg = await readCampaign(client, opts.slot);
  if (!cfg) return { skipped: "missing" };
  const products = opts.flux === "products";
  if (!cfg.enabled || !(products ? cfg.products_enabled : cfg.announcements_enabled)) return { skipped: "disabled" };
  const channels = products ? cfg.products_channels : cfg.announce_channels;
  if (!Object.values(channels).some(Boolean)) return { skipped: "not_configured" };
  const hours = products ? cfg.product_hours : cfg.media_hours;
  if (!opts.force && !hours.includes(localHour(now))) return { skipped: "not_scheduled" };
  const lockValue = products ? cfg.last_run_at : cfg.media_last_run_at;
  if (!opts.force && alreadyRanThisHour(lockValue, now)) return { skipped: "already_sent_this_hour" };

  const baseUrl = publicBaseUrl();
  const ctx: Ctx = { report: emptyReport(), waOk: false };
  for (const c of ["group", "status", "channel", "facebook", "instagram"] as const) if (!channels[c]) ctx.report[c].skipped = "disabled";
  if (channels.group && !cfg.group_id) ctx.report.group.skipped = "not_configured";
  if (channels.channel && !cfg.channel_id) ctx.report.channel.skipped = "not_configured";
  const needsWa = !!((channels.group && cfg.group_id) || channels.status || (channels.channel && cfg.channel_id));

  if (products) {
    const plan = buildDripPlan(await quartierGroups(client, cfg), cfg, baseUrl, opts.slot);
    if (!plan) return { skipped: "no_publishable_category" };
    if (opts.dry) return { dry: true, plan };
    if (opts.advance !== false && !(await claimFlux(client, "products", opts.slot, lockValue, now, plan.itemId))) {
      return { skipped: "already_sent_this_hour" };
    }
    await checkWhatsApp(client, ctx, cfg, needsWa, `les annonces de ${plan.quartier}`, opts.slot);

    if (channels.group && cfg.group_id) {
      const group = cfg.group_id;
      await waStep(ctx, "group", () => waSendText(group, plan.header), "en-tête");
      for (const p of plan.products.slice(0, productsFor(cfg, "group"))) await waStep(ctx, "group", () => waSendMedia(group, p.imageUrl, "image", p.caption));
    }
    if (channels.status) {
      for (const p of plan.products.slice(0, productsFor(cfg, "status"))) await waStep(ctx, "status", () => waSendStatus(p.imageUrl, "image", p.caption.replace("utm_source=group", "utm_source=status")));
    }
    if (channels.channel && cfg.channel_id) {
      const channel = cfg.channel_id;
      await waStep(ctx, "channel", () => waSendText(channel, plan.header), "en-tête");
      for (const p of plan.products.slice(0, productsFor(cfg, "channel"))) {
        await waStep(ctx, "channel", () => waSendMedia(channel, p.imageUrl, "image", p.caption.replace("utm_source=group", "utm_source=channel")));
      }
    }
    if (channels.facebook) {
      const picked = plan.products.slice(0, productsFor(cfg, "facebook"));
      for (const p of picked) record(ctx, "facebook", await fbStory(p.imageUrl, "image"), "story");
      for (const p of picked.slice(0, facebookPostsFor(cfg))) record(ctx, "facebook", await fbPost(p.imageUrl, "image", p.social), "publication");
    }
    if (channels.instagram) {
      const picked = plan.products.slice(0, productsFor(cfg, "instagram"));
      for (const p of picked) record(ctx, "instagram", await igStory(p.imageUrl, "image"), "story");
      for (const p of picked.slice(0, instagramPostsFor(cfg))) {
        record(ctx, "instagram", await igPost(p.imageUrl, "image", p.social.replace("utm_source=facebook", "utm_source=instagram")), "publication");
      }
    }
    const summary = `🏠 ${plan.quartier} (${plan.index + 1}/${plan.total}) · ${summarizeReport(ctx.report)}`;
    await journal(client, opts.slot, summary, opts.actor);
    return { sent: true, summary, report: ctx.report };
  }

  // Flux « médiathèque »
  const batch = buildMediaBatch(await readMedia(client), cfg, signupLink(baseUrl, "media", opts.slot));
  if (!batch.length) return { skipped: "no_media" };
  if (opts.dry) return { dry: true, plan: batch };
  if (opts.advance !== false && !(await claimFlux(client, "announcements", opts.slot, lockValue, now, batch[0].item.id, batch.length))) {
    return { skipped: "already_sent_this_hour" };
  }
  await checkWhatsApp(client, ctx, cfg, needsWa, "les annonces de la médiathèque", opts.slot);
  const networks = channels.facebook || channels.instagram;
  for (const [i, m] of batch.entries()) {
    // WhatsApp tombé et aucun réseau coché : inutile d'enchaîner les échecs.
    if (!ctx.waOk && !networks) break;
    if (channels.group && cfg.group_id) {
      const group = cfg.group_id;
      await waStep(ctx, "group", () => waSendMedia(group, m.item.url, m.item.kind, m.caption));
    }
    if (channels.status) await waStep(ctx, "status", () => waSendStatus(m.item.url, m.item.kind, m.caption));
    if (channels.channel && cfg.channel_id) {
      const channel = cfg.channel_id;
      await waStep(ctx, "channel", () => waSendMedia(channel, m.item.url, m.item.kind, m.caption));
    }
    const social = socialCaption(m.caption);
    if (channels.facebook) {
      record(ctx, "facebook", await fbStory(m.item.url, m.item.kind), "story");
      if (cfg.announce_posts.facebook) record(ctx, "facebook", await fbPost(m.item.url, m.item.kind, social), "publication");
    }
    if (channels.instagram) {
      record(ctx, "instagram", await igStory(m.item.url, m.item.kind), "story");
      if (cfg.announce_posts.instagram) record(ctx, "instagram", await igPost(m.item.url, m.item.kind, social), "publication");
    }
    if (i < batch.length - 1) await sleep(MEDIA_PAUSE_MS);
  }
  const summary = `🎬 ${batch.length} annonce${batch.length > 1 ? "s" : ""} · ${summarizeReport(ctx.report)}`;
  await journal(client, opts.slot, summary, opts.actor);
  return { sent: true, summary, report: ctx.report };
}

/** Toutes les campagnes, l'une après l'autre (jamais en parallèle), les deux flux. */
export async function runAllDrips(client: Client, opts: Omit<RunOptions, "slot" | "flux"> & { slot?: number }, now = new Date()) {
  const results: { slot: number; flux: DripFlux; result: RunResult }[] = [];
  if (!(await diffusionInstalled(client))) return [{ slot: 0, flux: "products" as DripFlux, result: { skipped: "not_installed" as RunSkip } }];
  const campaigns = opts.slot ? [{ slot: opts.slot }] : await listCampaigns(client);
  for (const { slot } of campaigns) {
    for (const flux of ["products", "announcements"] as const) {
      try {
        results.push({ slot, flux, result: await runFlux(client, { ...opts, slot, flux }, now) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "erreur";
        await journal(client, slot, `⚠️ Échec de la diffusion (${flux}) : ${message.slice(0, 200)}`, opts.actor).catch(() => undefined);
        results.push({ slot, flux, result: { skipped: "not_configured" } });
      }
    }
  }
  return results;
}
