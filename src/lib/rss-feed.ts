// Lecture d'un flux rss.app (format JSON Feed) de sources Facebook et TikTok.
// Un flux peut être un « bundle » mêlant plusieurs groupes, profils d'agents ou
// comptes TikTok : chaque publication est rattachée à sa source grâce à son lien.

export interface FeedPost {
  /** Type de source : groupe Facebook, profil / page Facebook, ou compte TikTok. */
  kind: "group" | "profile" | "tiktok";
  /** Identifiant de la source : identifiant du groupe, identifiant / nom d'utilisateur du profil, ou nom du compte TikTok sans « @ ». */
  sourceId: string;
  /** Identifiant de la publication, tiré du lien. Pour TikTok : « tiktok_<id de la vidéo> ». */
  postId: string;
  url: string;
  author: string | null;
  text: string;
  /** Le flux ne fournit qu'une image par publication (la première de la galerie). */
  images: string[];
  publishedAt: string | null;
}

const GROUP_POST = /facebook\.com\/groups\/(\d+)\/(?:posts|permalink)\/(\d+)/;
// Profils et pages : /permalink.php?id=<profil>&story_fbid=<publication>
const PROFILE_PERMALINK = /facebook\.com\/permalink\.php\?(?:[^#]*&)?id=(\d+)/;
const STORY_ID = /[?&]story_fbid=([\w-]+)/;
// … ou /<nom d'utilisateur>/posts/<publication>
const PROFILE_POST = /facebook\.com\/([A-Za-z0-9.]+)\/posts\/([\w-]+)/;
const TIKTOK_POST = /tiktok\.com\/@([\w.]+)\/(?:video|photo)\/(\d+)/;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * Texte lisible d'un fragment HTML : les sauts de ligne sont conservés, les balises retirées.
 *
 * @example htmlToText("<p>Prix : 450.000<br>GARDIEN</p>") // "Prix : 450.000\nGARDIEN"
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole: string, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Texte le plus complet d'un élément du flux.
 * WHY: selon la publication, rss.app met tout le texte dans `content_text`, ou seulement sa
 * première ligne (le titre mis en forme par Facebook) et le reste dans `content_html` ou `summary`.
 * On retient la version la plus longue, et on replace le titre en tête s'il n'y figure pas.
 */
export function bestText(item: Record<string, unknown>): string {
  const candidates = [asString(item.content_text), htmlToText(asString(item.content_html)), asString(item.summary), htmlToText(asString(item.description))]
    .map((t) => t.trim())
    .filter(Boolean);
  const body = candidates.sort((a, b) => b.length - a.length)[0] || "";
  const title = asString(item.title).trim();
  if (!title) return body;
  if (!body) return title;
  const head = title.slice(0, 40).toLowerCase();
  return body.toLowerCase().includes(head) ? body : `${title}\n${body}`;
}

/**
 * Forme d'un flux, sans aucun contenu : quels champs existent et lequel porte le texte le plus long.
 * Sert à diagnostiquer un flux qui tronque les publications.
 *
 * @example feedShape(feed) // { items: 50, keys: ["content_html", …], htmlLonger: 12, shortText: 9, … }
 */
export function feedShape(feed: unknown) {
  const items = (feed as { items?: unknown })?.items;
  const list = Array.isArray(items) ? (items.filter((i) => i && typeof i === "object") as Record<string, unknown>[]) : [];
  const keys = new Set<string>();
  const shape = { items: list.length, keys: [] as string[], htmlLonger: 0, summaryLonger: 0, titleEqualsText: 0, shortText: 0, medianText: 0, medianBest: 0, attachments: 0 };
  const textLengths: number[] = [];
  const bestLengths: number[] = [];
  for (const item of list) {
    Object.keys(item).forEach((k) => keys.add(k));
    const text = asString(item.content_text).trim();
    const html = htmlToText(asString(item.content_html));
    if (html.length > text.length + 20) shape.htmlLonger++;
    if (asString(item.summary).trim().length > text.length + 20) shape.summaryLonger++;
    if (text && text === asString(item.title).trim()) shape.titleEqualsText++;
    if (text.length < 80) shape.shortText++;
    if (Array.isArray(item.attachments) && item.attachments.length > 1) shape.attachments++;
    textLengths.push(text.length);
    bestLengths.push(bestText(item).length);
  }
  const median = (values: number[]) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0);
  shape.keys = Array.from(keys).sort();
  shape.medianText = median(textLengths);
  shape.medianBest = median(bestLengths);
  return shape;
}

function locate(url: string): Pick<FeedPost, "kind" | "sourceId" | "postId"> | null {
  const tiktok = url.match(TIKTOK_POST);
  // WHY: même forme d'identifiant que la collecte TikTok historique, pour ne pas recréer ses annonces.
  if (tiktok) return { kind: "tiktok", sourceId: tiktok[1], postId: `tiktok_${tiktok[2]}` };

  const group = url.match(GROUP_POST);
  if (group) return { kind: "group", sourceId: group[1], postId: group[2] };

  const permalink = url.match(PROFILE_PERMALINK);
  const story = url.match(STORY_ID);
  if (permalink && story) return { kind: "profile", sourceId: permalink[1], postId: story[1] };

  const profile = url.match(PROFILE_POST);
  if (profile && profile[1] !== "groups") return { kind: "profile", sourceId: profile[1], postId: profile[2] };

  return null;
}

/**
 * Extrait les publications exploitables d'un flux JSON rss.app.
 * Les éléments dont le lien ne désigne ni un groupe, ni un profil, ni une vidéo TikTok sont ignorés.
 *
 * @example
 * const posts = parseFeed(await (await fetch(url)).json());
 */
export function parseFeed(feed: unknown): FeedPost[] {
  const items = (feed as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const posts: FeedPost[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    const url = asString(item.url);
    const location = locate(url);
    if (!location) continue;

    const authors = Array.isArray(item.authors) ? (item.authors as Record<string, unknown>[]) : [];
    const attachments = Array.isArray(item.attachments) ? (item.attachments as Record<string, unknown>[]) : [];
    const images = [asString(item.image), ...attachments.map((a) => asString(a?.url))].filter(Boolean);

    const date = asString(item.date_published);
    const time = date ? Date.parse(date) : NaN;

    posts.push({
      ...location,
      url,
      author: asString(authors[0]?.name) || null,
      text: bestText(item),
      images: Array.from(new Set(images)),
      publishedAt: Number.isNaN(time) ? null : new Date(time).toISOString(),
    });
  }

  // Du plus ancien au plus récent : si un passage est interrompu, le suivant reprend sans trou.
  return posts.sort((a, b) => (a.publishedAt || "").localeCompare(b.publishedAt || ""));
}

/** Adresses de flux configurées (RSS_FEED_URLS, séparées par des virgules ou des espaces). */
export function configuredFeedUrls(): string[] {
  return (process.env.RSS_FEED_URLS || "")
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^https:\/\//.test(u));
}

/**
 * Nom d'un compte TikTok tel qu'enregistré dans l'application, ramené à la forme du flux :
 * sans « @ », sans lien, en minuscules. Accepte « @compte », « compte » ou le lien du profil.
 *
 * @example tiktokHandle("https://www.tiktok.com/@Immobilier241?lang=fr") // "immobilier241"
 */
export function tiktokHandle(value: string | null | undefined): string {
  const raw = (value || "").trim();
  const fromUrl = raw.match(/tiktok\.com\/@([\w.]+)/i);
  const handle = fromUrl ? fromUrl[1] : raw.replace(/^@+/, "").split(/[/?\s]/)[0];
  return /^[\w.]+$/.test(handle) ? handle.toLowerCase() : "";
}
