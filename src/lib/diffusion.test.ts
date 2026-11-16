import { describe, expect, it } from "vitest";
import {
  alreadyRanThisHour,
  buildDripPlan,
  buildMediaBatch,
  dailyVolume,
  DEFAULT_DRIP_CONFIG,
  emptyReport,
  localHour,
  localHourKey,
  maxProductsPerHour,
  mergeChannels,
  nextFreeDripSlot,
  normalizeDripConfig,
  normalizeMedia,
  pickIndex,
  productsFor,
  publishableQuartiers,
  summarizeReport,
  type DiffusionAnnonce,
  type MediaItem,
} from "./diffusion";

const BASE = "https://www.micasagabon.com";

const annonce = (id: string, quartier: string | null, o: Partial<DiffusionAnnonce> = {}): DiffusionAnnonce => ({
  id,
  quartier,
  type_offre: "location",
  type_bien: "appartement",
  prix: 250000,
  nb_chambres: 2,
  meuble: false,
  photo: `https://x.supabase.co/storage/v1/object/public/annonces/${id}.jpg`,
  date: "2026-11-16T08:00:00Z",
  ...o,
});

describe("configuration d'une campagne", () => {
  it("rend les valeurs par défaut pour un objet vide ou invalide", () => {
    expect(normalizeDripConfig({})).toEqual({ ...DEFAULT_DRIP_CONFIG, media_scope: "all" });
    expect(normalizeDripConfig(null).enabled).toBe(false);
    expect(normalizeDripConfig("n'importe quoi").product_hours).toEqual([9, 12, 15, 18, 21]);
  });

  it("borne les nombres, nettoie et trie les heures, rejette les identifiants invalides", () => {
    const cfg = normalizeDripConfig({
      per_category: 12,
      per_hour_other: 0,
      product_hours: [18, 9, 9, 25, -1, "12"],
      media_hours: [],
      group_id: "pas-un-groupe",
      channel_id: "120363000000000000@newsletter",
      per_channel: { facebook: 9, facebook_posts: 0, status: null },
      quartiers: [" Okala ", "Okala", "", 3],
    });
    expect(cfg.per_category).toBe(5);
    expect(cfg.per_hour_other).toBe(1);
    expect(cfg.product_hours).toEqual([9, 12, 18]);
    expect(cfg.media_hours).toEqual([10]);
    expect(cfg.group_id).toBeNull();
    expect(cfg.channel_id).toBe("120363000000000000@newsletter");
    expect(cfg.per_channel).toEqual({ facebook: 5, facebook_posts: 0 });
    expect(cfg.quartiers).toEqual(["Okala"]);
  });

  it("périmètre de la médiathèque : « toutes » sans sélection, « sélection » sinon, ou valeur explicite", () => {
    expect(normalizeDripConfig({ media_ids: [] }).media_scope).toBe("all");
    expect(normalizeDripConfig({ media_ids: ["a"] }).media_scope).toBe("selected");
    expect(normalizeDripConfig({ media_scope: "selected" }).media_scope).toBe("selected");
  });

  it("fusionne les canaux champ par champ", () => {
    const merged = mergeChannels(DEFAULT_DRIP_CONFIG.products_channels, { instagram: true, group: "oui" });
    expect(merged).toEqual({ group: true, status: false, channel: false, facebook: false, instagram: true });
  });

  it("trouve le premier emplacement libre", () => {
    expect(nextFreeDripSlot([1, 2, 4])).toBe(3);
    expect(nextFreeDripSlot(Array.from({ length: 12 }, (_, i) => i + 1))).toBeNull();
  });
});

describe("rythmes", () => {
  it("le groupe suit per_category, les autres per_hour_other, per_channel prime", () => {
    const cfg = normalizeDripConfig({ per_category: 4, per_hour_other: 2, per_channel: { instagram: 1, instagram_posts: 0 } });
    expect(productsFor(cfg, "group")).toBe(4);
    expect(productsFor(cfg, "status")).toBe(2);
    expect(productsFor(cfg, "instagram")).toBe(1);
    expect(cfg.per_channel.instagram_posts).toBe(0);
    expect(maxProductsPerHour(cfg)).toBe(4);
  });
});

describe("heure locale (Libreville)", () => {
  it("calcule l'heure et la clé horaire locales, change de jour au bon moment", () => {
    expect(localHour(new Date("2026-11-15T23:30:00Z"))).toBe(0); // 00 h 30 le 16
    expect(localHourKey(new Date("2026-11-15T23:30:00Z"))).toBe("2026-11-16-00");
    expect(localHourKey(new Date("2026-11-15T22:59:00Z"))).toBe("2026-11-15-23");
  });

  it("verrou horaire : même heure locale → déjà parti ; date invalide → non", () => {
    const now = new Date("2026-11-16T08:40:00Z");
    expect(alreadyRanThisHour("2026-11-16T08:10:00Z", now)).toBe(true);
    expect(alreadyRanThisHour("2026-11-16T06:59:00Z", now)).toBe(false);
    expect(alreadyRanThisHour("pas une date", now)).toBe(false);
    expect(alreadyRanThisHour(null, now)).toBe(false);
  });
});

describe("annonces par quartier", () => {
  const annonces = [
    annonce("a1", "Okala"),
    annonce("a2", "Okala", { date: "2026-11-16T09:00:00Z" }),
    annonce("a3", "Angondjé"),
    annonce("a4", "Akanda", { prix: null }),
    annonce("a5", "Nzeng-Ayong", { photo: null }),
    annonce("a6", null),
  ];

  it("ne garde que les annonces avec quartier, prix et photo, quartiers les plus fournis d'abord", () => {
    const groups = publishableQuartiers(annonces, []);
    expect(groups.map((g) => g.quartier)).toEqual(["Okala", "Angondjé"]);
    expect(groups[0].annonces.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(publishableQuartiers(annonces, ["angondjé"]).map((g) => g.quartier)).toEqual(["Angondjé"]);
  });

  it("choisit le quartier par le curseur, y compris négatif ou au-delà du total", () => {
    expect(pickIndex(5, 2)).toBe(1);
    expect(pickIndex(-1, 3)).toBe(2);
    expect(pickIndex(0, 0)).toBe(-1);
  });

  it("construit un plan : en-tête, annonces au nombre maximal, légendes réseaux sans * ni _", () => {
    const groups = publishableQuartiers(annonces, []);
    const plan = buildDripPlan(groups, normalizeDripConfig({ cursor: 0, per_category: 1, per_hour_other: 2 }), BASE, 3);
    expect(plan?.quartier).toBe("Okala");
    expect(plan?.header).toContain("*Nouvelles annonces à Okala*");
    expect(plan?.products).toHaveLength(2);
    expect(plan?.products[0].caption).toContain("250 000 FCFA / mois");
    expect(plan?.products[0].caption).toContain("utm_campaign=diffusion-3");
    expect(plan?.products[0].social).not.toMatch(/[*]/);
    // Mise en forme retirée du texte, lien intact (il contient « utm_ »).
    expect(plan?.products[0].social.split("👉")[0]).not.toContain("_");
    expect(plan?.products[0].social).toContain("utm_source=facebook");
    expect(buildDripPlan([], DEFAULT_DRIP_CONFIG, BASE, 1)).toBeNull();
  });
});

describe("médiathèque", () => {
  const media: MediaItem[] = normalizeMedia([
    { id: "m1", url: "https://x/a.jpg", caption: "Visite", active: true },
    { id: "m2", url: "https://x/b.mp4", active: true },
    { id: "m3", url: "https://x/c.jpg", active: false },
    { id: "m4", url: "ftp://x/d.jpg" },
  ]);

  it("normalise : liens http(s) seulement, type déduit du fichier", () => {
    expect(media.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(media[1].kind).toBe("video");
  });

  it("toutes les annonces actives à chaque créneau (lot 0), ou N en boucle", () => {
    const all = normalizeDripConfig({ media_scope: "all", media_batch: 0 });
    expect(buildMediaBatch(media, all, "L").map((p) => p.item.id)).toEqual(["m1", "m2"]);
    const loop = normalizeDripConfig({ media_scope: "all", media_batch: 1, media_cursor: 3 });
    expect(buildMediaBatch(media, loop, "L").map((p) => p.item.id)).toEqual(["m2"]);
    expect(buildMediaBatch(media, normalizeDripConfig({ media_scope: "selected", media_ids: [] }), "L")).toEqual([]);
    expect(buildMediaBatch(media, all, "https://lien")[0].caption).toBe(
      "Visite\n\n🏠 Mi Casa Gabon : les annonces de votre quartier sur WhatsApp.\n\n👉 https://lien"
    );
  });
});

describe("volume quotidien", () => {
  it("compte produits et annonces par canal, double Facebook avec publication, zéro en pause", () => {
    const cfg = normalizeDripConfig({
      enabled: true,
      product_hours: [9, 18],
      per_category: 3,
      products_channels: { group: true, status: true },
      announcements_enabled: true,
      media_hours: [10],
      announce_channels: { group: true, facebook: true },
    });
    expect(dailyVolume(cfg, 2)).toEqual({ group: 2 * 4 + 2, status: 2, channel: 0, facebook: 4, instagram: 0 });
    expect(dailyVolume({ ...cfg, enabled: false }, 2)).toEqual({ group: 0, status: 0, channel: 0, facebook: 0, instagram: 0 });
  });
});

describe("bilan", () => {
  it("résume par canal : désactivé absent, non configuré ⚙︎, erreurs comptées", () => {
    const r = emptyReport();
    r.group.sent = 4;
    r.status.skipped = "disabled";
    r.channel.skipped = "not_configured";
    r.facebook.sent = 2;
    r.facebook.errors.push("Graph 400");
    r.instagram.skipped = "disabled";
    expect(summarizeReport(r)).toBe("groupe 4 · chaîne ⚙︎ · facebook 2 (1 err.)");
  });
});
