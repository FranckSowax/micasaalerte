import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { publicBaseUrl } from "@/lib/client-access";
import {
  announcementsPerSlot,
  buildDripPlan,
  buildMediaBatch,
  campaignTitle,
  CHANNEL_ID_PATTERN,
  dailyVolume,
  DEFAULT_DRIP_CONFIG,
  DRIP_CHANNELS,
  DRIP_MAX_PER_CATEGORY,
  GROUP_ID_PATTERN,
  mergeChannels,
  nextFreeDripSlot,
  normalizeDripConfig,
  normalizeHours,
  parseDripSlot,
  PER_CHANNEL_KEYS,
  publishableQuartiers,
  signupLink,
  type DripChannel,
  type DripConfig,
} from "@/lib/diffusion";
import { listWhatsAppChannels, listWhatsAppGroups, metaFacebookConfigured, metaInstagramConfigured, whatsappDownMessage, whatsappHealth, type WaGroup } from "@/lib/diffusion-channels";
import { deleteCampaign, diffusionInstalled, listCampaigns, loadDiffusionAnnonces, readCampaign, readMedia, recentJournal, saveCampaign } from "@/lib/diffusion-runner";

// Onglet Diffusion (agents autorisés) : lecture, enregistrement et suppression des campagnes.

export const dynamic = "force-dynamic";

// Dernière liste de groupes connue : servie quand WhatsApp ne répond pas, plutôt qu'un écran vide.
let groupsCache: WaGroup[] = [];

async function requireAgent() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

const NOT_INSTALLED = {
  installed: false,
  error: "Les tables de la diffusion n'existent pas encore : exécutez la section « Diffusion » de supabase_schema.sql dans Supabase (SQL Editor).",
};

export async function GET(request: Request) {
  if (!(await requireAgent())) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const service = createServiceClient();
  if (!(await diffusionInstalled(service))) return NextResponse.json(NOT_INSTALLED);

  const url = new URL(request.url);
  const slotParam = url.searchParams.get("slot");
  const [campaigns, media, annonces, health, groupsLive, channels] = await Promise.all([
    listCampaigns(service),
    readMedia(service),
    loadDiffusionAnnonces(service),
    whatsappHealth(),
    listWhatsAppGroups(),
    listWhatsAppChannels(),
  ]);
  if (groupsLive) groupsCache = groupsLive;
  const groups = groupsLive ?? groupsCache;
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? null;

  const totals: Record<DripChannel, number> = { group: 0, status: 0, channel: 0, facebook: 0, instagram: 0 };
  const summaries = campaigns.map(({ slot, config }) => {
    const perSlot = announcementsPerSlot(media, config);
    const volume = dailyVolume(config, perSlot);
    for (const c of DRIP_CHANNELS) totals[c] += volume[c];
    const extra = DRIP_CHANNELS.filter((c) => c !== "group" && (config.products_channels[c] || config.announce_channels[c]));
    return {
      slot,
      title: campaignTitle(config, slot, groupName(config.group_id)),
      enabled: config.enabled,
      group_name: groupName(config.group_id),
      quartiers: config.quartiers,
      products: { enabled: config.products_enabled, hours: config.product_hours },
      announcements: { enabled: config.announcements_enabled, hours: config.media_hours, per_slot: perSlot },
      extra_channels: extra,
      last_run_at: [config.last_run_at, config.media_last_run_at].filter(Boolean).sort().pop() ?? null,
    };
  });

  const allQuartiers = publishableQuartiers(annonces, []).map((g) => ({ quartier: g.quartier, count: g.annonces.length }));
  const base = {
    installed: true,
    campaigns: summaries,
    totals,
    whatsapp: { ok: health.ok, status: health.status, message: health.ok ? null : whatsappDownMessage(health.status) },
    groups,
    groups_stale: !groupsLive && groups.length > 0,
    channels: channels ?? [],
    quartiers: allQuartiers,
    media,
    ready: {
      group: health.ok,
      status: health.ok,
      channel: health.ok && (channels?.length ?? 0) > 0,
      facebook: metaFacebookConfigured(),
      instagram: metaInstagramConfigured(),
    },
    next_free_slot: nextFreeDripSlot(campaigns.map((c) => c.slot)),
  };
  if (!slotParam) return NextResponse.json(base);

  const slot = parseDripSlot(slotParam);
  const config = campaigns.find((c) => c.slot === slot)?.config ?? null;
  if (!config) return NextResponse.json({ ...base, slot, config: null });
  const baseUrl = publicBaseUrl();
  const groupsForCampaign = publishableQuartiers(annonces, config.quartiers);
  return NextResponse.json({
    ...base,
    slot,
    config,
    categories: groupsForCampaign.length,
    next: buildDripPlan(groupsForCampaign, config, baseUrl, slot),
    next_batch: buildMediaBatch(media, config, signupLink(baseUrl, "media", slot)),
    volume: dailyVolume(config, announcementsPerSlot(media, config)),
    recent: await recentJournal(service, slot),
  });
}

/** Valide et applique une modification ; renvoie un message en clair si elle est refusée. */
function applyPatch(current: DripConfig, body: Record<string, unknown>, others: { slot: number; config: DripConfig }[], groups: WaGroup[]): DripConfig | string {
  const next: DripConfig = { ...current };
  if ("group_id" in body) {
    const g = body.group_id;
    if (g === null || g === "") next.group_id = null;
    else if (typeof g !== "string" || !GROUP_ID_PATTERN.test(g)) return "group_id invalide (attendu : …@g.us)";
    else {
      // Un groupe = une campagne.
      const taken = others.find((o) => o.config.group_id === g);
      if (taken) return `Ce groupe a déjà sa campagne (${campaignTitle(taken.config, taken.slot, groups.find((x) => x.id === g)?.name)}).`;
      next.group_id = g;
    }
  }
  if ("channel_id" in body) {
    const c = body.channel_id;
    if (c === null || c === "") next.channel_id = null;
    else if (typeof c !== "string" || !CHANNEL_ID_PATTERN.test(c)) return "channel_id invalide (attendu : …@newsletter)";
    else next.channel_id = c;
  }
  for (const k of ["per_category", "per_hour_other"] as const) {
    if (!(k in body)) continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < 1 || n > DRIP_MAX_PER_CATEGORY) return `${k} entre 1 et ${DRIP_MAX_PER_CATEGORY}`;
    next[k] = n;
  }
  if (body.per_channel && typeof body.per_channel === "object") {
    const pc = { ...next.per_channel };
    for (const [k, v] of Object.entries(body.per_channel as Record<string, unknown>)) {
      if (!(PER_CHANNEL_KEYS as readonly string[]).includes(k)) continue;
      const key = k as (typeof PER_CHANNEL_KEYS)[number];
      if (v === null) {
        delete pc[key];
        continue;
      }
      const min = k.endsWith("_posts") ? 0 : 1;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > DRIP_MAX_PER_CATEGORY) return `per_channel.${k} entre ${min} et ${DRIP_MAX_PER_CATEGORY}`;
      pc[key] = n;
    }
    next.per_channel = pc;
  }
  for (const k of ["cursor", "media_cursor", "media_batch"] as const) {
    if (!(k in body)) continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < 0) return `${k} invalide`;
    next[k] = n;
  }
  // Repositionner un curseur lève le verrou du flux : reprise au prochain créneau, sans doublon.
  if ("cursor" in body) next.last_run_at = null;
  if ("media_cursor" in body) next.media_last_run_at = null;
  if ("quartiers" in body) {
    const q = Array.isArray(body.quartiers) ? body.quartiers : [];
    const before = current.quartiers.join("|");
    next.quartiers = normalizeDripConfig({ quartiers: q }).quartiers;
    // Changer de quartiers remet la boucle à zéro.
    if (next.quartiers.join("|") !== before) {
      next.cursor = 0;
      next.last_run_at = null;
    }
  }
  if ("name" in body) next.name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : null;
  for (const k of ["enabled", "products_enabled", "announcements_enabled"] as const) if (typeof body[k] === "boolean") next[k] = body[k] as boolean;
  if ("product_hours" in body) next.product_hours = normalizeHours(body.product_hours, current.product_hours);
  if ("media_hours" in body) next.media_hours = normalizeHours(body.media_hours, current.media_hours);
  if ("products_channels" in body) next.products_channels = mergeChannels(current.products_channels, body.products_channels);
  if ("announce_channels" in body) next.announce_channels = mergeChannels(current.announce_channels, body.announce_channels);
  if (body.announce_posts && typeof body.announce_posts === "object") {
    const p = body.announce_posts as Record<string, unknown>;
    next.announce_posts = {
      facebook: typeof p.facebook === "boolean" ? p.facebook : current.announce_posts.facebook,
      instagram: typeof p.instagram === "boolean" ? p.instagram : current.announce_posts.instagram,
    };
  }
  if (body.media_scope === "all" || body.media_scope === "selected") next.media_scope = body.media_scope;
  if (Array.isArray(body.media_ids)) next.media_ids = body.media_ids.filter((m): m is string => typeof m === "string");
  return normalizeDripConfig(next);
}

export async function POST(request: Request) {
  if (!(await requireAgent())) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const service = createServiceClient();
  if (!(await diffusionInstalled(service))) return NextResponse.json(NOT_INSTALLED, { status: 409 });
  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  const campaigns = await listCampaigns(service);

  let slot: number;
  let current: DripConfig;
  if (body.create === true) {
    const free = nextFreeDripSlot(campaigns.map((c) => c.slot));
    if (!free) return NextResponse.json({ error: "Les 12 emplacements de campagne sont pris : supprimez-en une pour en créer une nouvelle." }, { status: 409 });
    slot = free;
    current = { ...DEFAULT_DRIP_CONFIG };
  } else {
    slot = parseDripSlot(body.slot);
    const found = await readCampaign(service, slot);
    if (!found) return NextResponse.json({ error: "Campagne introuvable." }, { status: 404 });
    current = found;
  }

  const next = applyPatch(current, body, campaigns.filter((c) => c.slot !== slot), (await listWhatsAppGroups()) ?? groupsCache);
  if (typeof next === "string") return NextResponse.json({ error: next }, { status: 400 });
  const error = await saveCampaign(service, slot, next);
  if (error) return NextResponse.json({ error: `Enregistrement impossible : ${error}` }, { status: 500 });
  // La configuration renvoyée est celle réellement stockée.
  return NextResponse.json({ slot, config: await readCampaign(service, slot) });
}

export async function DELETE(request: Request) {
  if (!(await requireAgent())) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const service = createServiceClient();
  const slot = parseDripSlot(new URL(request.url).searchParams.get("slot"));
  // Le journal est conservé.
  await deleteCampaign(service, slot);
  return NextResponse.json({ success: true, slot });
}
