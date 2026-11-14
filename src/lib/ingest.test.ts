import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIExtractionResult } from "./ai";

// L'IA est simulée : on compte ses appels et on choisit ce qu'elle « extrait ».
const analyze = vi.fn<(text: string) => Promise<AIExtractionResult>>();
vi.mock("./ai", () => ({ analyzePost: (text: string) => analyze(text) }));

import { DedupeIndex, ingestPost, mergeExistingDuplicates, type IngestInput } from "./ingest";

type Row = Record<string, unknown>;

/** Fausse base en mémoire, limitée aux appels Supabase utilisés par la collecte. */
function fakeClient(tables: Record<string, Row[]>) {
  let nextId = 1;
  const from = (table: string) => {
    const rows = (tables[table] = tables[table] || []);
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let inserted: Row | null = null;
    const run = () => {
      if (inserted) return [inserted];
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) hit.forEach((r) => Object.assign(r, patch));
      return hit;
    };
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (row: Row) => {
        inserted = { id: `${table}-${nextId++}`, created_at: new Date().toISOString(), status: "new", ...row };
        rows.push(inserted);
        return q;
      },
      update: (p: Row) => {
        patch = p;
        return q;
      },
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), q),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: run(), error: null }),
    };
    return q;
  };
  return { from } as never;
}

const TEXT =
  "APPARTEMENT BON STANDING À LOUER ANGONDJÉ APRÈS LA MOSQUÉE DE LA PAIX. 2 CHAMBRES AVEC PLACARDS, SALON, CUISINE, DOUCHE, TERRASSE. Loyer 250 000 FCFA, caution 2 mois. Contact 062 09 08 02";

const sheet = (overrides: Partial<AIExtractionResult> = {}): AIExtractionResult =>
  ({
    is_real_estate: true,
    type_offre: "location",
    type_bien: "appartement",
    prix: 250000,
    devise: "FCFA",
    nb_pieces: null,
    nb_chambres: 2,
    nb_salles_bain: null,
    superficie: null,
    meuble: null,
    quartier: "Angondjé",
    ville: null,
    adresse_complete: null,
    telephone: "+24162090802",
    whatsapp: null,
    email: null,
    summary: "Appartement à louer.",
    confidence: 0.9,
    tags: [],
    details: { hors_gabon: false, telephones: ["+24162090802"] },
    ...overrides,
  }) as unknown as AIExtractionResult;

const post = (overrides: Partial<IngestInput> = {}): IngestInput => ({
  userId: "u1",
  sourceType: "group",
  sourceRowId: "g1",
  postId: "p1",
  url: "https://facebook.com/groups/1/posts/1/",
  author: "LEWIS IMMO",
  text: TEXT,
  images: [],
  publishedAt: "2026-11-14T18:00:00.000Z",
  ...overrides,
});

describe("ingestPost avec anti-doublons", () => {
  let tables: Record<string, Row[]>;
  let client: never;
  let index: DedupeIndex;

  beforeEach(() => {
    tables = { annonces: [], raw_posts: [] };
    client = fakeClient(tables);
    index = new DedupeIndex();
    analyze.mockReset();
    analyze.mockResolvedValue(sheet());
  });

  it("crée l'annonce à la première publication", async () => {
    expect(await ingestPost(client, post(), index)).toBe("new_annonce");
    expect(tables.annonces).toHaveLength(1);
    expect(tables.raw_posts[0]).toMatchObject({ ai_status: "real_estate", annonce_id: tables.annonces[0].id });
  });

  it("rattache une rediffusion par un autre diffuseur sans rappeler l'IA", async () => {
    await ingestPost(client, post(), index);
    const relayed = post({
      postId: "tiktok_99",
      sourceType: "tiktok",
      sourceRowId: null,
      author: "@autre_agence",
      text: "Bonjour la famille 🙏 " + TEXT.replace("062 09 08 02", "077 55 44 33"),
    });

    expect(await ingestPost(client, relayed, index)).toBe("duplicate");
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(tables.annonces).toHaveLength(1);
    expect(tables.raw_posts[1]).toMatchObject({ ai_status: "duplicate", annonce_id: tables.annonces[0].id });
    const details = tables.annonces[0].details as { sources: { post_id: string; author: string }[]; diffusions: number };
    expect(details.sources.map((s) => [s.post_id, s.author])).toEqual([["tiktok_99", "@autre_agence"]]);
    expect(details.diffusions).toBe(2);
  });

  it("ne compte pas deux fois la même rediffusion", async () => {
    await ingestPost(client, post(), index);
    const relayed = post({ postId: "p2", author: "Autre" });
    await ingestPost(client, relayed, index);
    tables.raw_posts[1].ai_status = "pending"; // remise en attente, puis retraitée
    await ingestPost(client, relayed, index);
    expect((tables.annonces[0].details as { sources: unknown[] }).sources).toHaveLength(1);
  });

  it("met à jour le prix et la version quand le même texte revient avec un autre montant", async () => {
    await ingestPost(client, post(), index);
    analyze.mockResolvedValue(sheet({ prix: 230000 }));

    const status = await ingestPost(client, post({ postId: "p2", text: TEXT.replace("250 000", "230 000") }), index);

    expect(status).toBe("price_update");
    expect(tables.annonces).toHaveLength(1);
    expect(tables.annonces[0].prix).toBe(230000);
    expect(tables.annonces[0].details).toMatchObject({ version: 2, historique_prix: [{ prix: 250000 }] });
  });

  it("garde distinctes deux annonces différentes du même agent", async () => {
    await ingestPost(client, post(), index);
    analyze.mockResolvedValue(sheet({ type_bien: "villa", prix: 600000, quartier: "Montagne Sainte", nb_chambres: 4 }));
    const other = post({
      postId: "p2",
      text: "VILLA MITOYENNE À LOUER À MONTAGNE SAINTE EN BORDURE DE ROUTE, 4 CHAMBRES AVEC PLACARDS, SALON, SALLE À MANGER. Loyer 600 000 FCFA. Contact 062 09 08 02",
    });
    expect(await ingestPost(client, other, index)).toBe("new_annonce");
    expect(tables.annonces).toHaveLength(2);
  });

  it("reconnaît la même fiche réécrite par le même diffuseur", async () => {
    await ingestPost(client, post(), index);
    const rewritten = post({ postId: "p2", text: "Dispo de suite : bel appart 2 chambres à Angondjé vers la mosquée, 250000 le mois. Appelez le 062090802" });
    expect(await ingestPost(client, rewritten, index)).toBe("duplicate");
    expect(analyze).toHaveBeenCalledTimes(2); // texte trop différent : l'IA est nécessaire pour comparer les fiches
    expect(tables.annonces).toHaveLength(1);
  });

  it("n'écarte pas comme doublon une publication non immobilière", async () => {
    await ingestPost(client, post(), index);
    analyze.mockResolvedValue(sheet({ is_real_estate: false }));
    expect(await ingestPost(client, post({ postId: "p2", text: "TOYOTA COROLLA À VENDRE, moteur d'origine, boîte manuelle, 3 700 000 FCFA à débattre" }), index)).toBe("not_real_estate");
  });

  it("sans index, ne dédoublonne pas (comportement d'origine)", async () => {
    await ingestPost(client, post());
    expect(await ingestPost(client, post({ postId: "p2" }))).toBe("new_annonce");
    expect(tables.annonces).toHaveLength(2);
  });
});

describe("mergeExistingDuplicates", () => {
  const annonce = (id: string, createdAt: string, overrides: Row = {}): Row => ({
    id,
    user_id: "u1",
    status: "new",
    ai_is_real_estate: true,
    created_at: createdAt,
    fb_post_id: `post-${id}`,
    fb_post_url: null,
    fb_author_name: "Agent",
    raw_text: TEXT,
    type_offre: "location",
    type_bien: "appartement",
    prix: 250000,
    quartier: "Angondjé",
    nb_chambres: 2,
    telephone: "+24162090802",
    whatsapp: null,
    details: {},
    ...overrides,
  });
  const recent = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

  it("archive les répétitions et garde la plus ancienne, sans rien supprimer", async () => {
    const tables = {
      annonces: [annonce("ancienne", recent(60)), annonce("repetition", recent(30)), annonce("autre", recent(10), { raw_text: "Terrain titré de 500 m2 à vendre à Bikélé, 8 000 000 FCFA à débattre, papiers en règle", type_offre: "vente", type_bien: "terrain", prix: 8000000, quartier: "Bikélé", telephone: null })],
      raw_posts: [{ id: "r1", annonce_id: "repetition" }],
    };
    const merged = await mergeExistingDuplicates(fakeClient(tables), new DedupeIndex(), "u1");

    expect(merged).toBe(1);
    expect(tables.annonces).toHaveLength(3);
    expect(tables.annonces.map((a) => [a.id, a.status])).toEqual([["ancienne", "new"], ["repetition", "archived"], ["autre", "new"]]);
    expect(tables.raw_posts[0].annonce_id).toBe("ancienne");
    expect((tables.annonces[0].details as { diffusions: number }).diffusions).toBe(2);
  });

  it("ne touche ni aux favoris ni aux annonces déjà envoyées", async () => {
    const tables = { annonces: [annonce("a", recent(60)), annonce("fav", recent(30), { status: "favorite" }), annonce("sent", recent(20), { status: "sent" })], raw_posts: [] };
    expect(await mergeExistingDuplicates(fakeClient(tables), new DedupeIndex(), "u1")).toBe(0);
    expect(tables.annonces.map((a) => a.status)).toEqual(["new", "favorite", "sent"]);
  });
});
