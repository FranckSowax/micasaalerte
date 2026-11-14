// Lecture d'un flux rss.app (format JSON Feed) de groupes Facebook.
// Un flux peut être un « bundle » mêlant plusieurs groupes : chaque publication
// est rattachée à son groupe grâce à l'identifiant présent dans son lien.

export interface FeedPost {
  /** Identifiant Facebook du groupe, tiré du lien. */
  groupId: string;
  /** Identifiant Facebook de la publication, tiré du lien. */
  postId: string;
  url: string;
  author: string | null;
  text: string;
  /** Le flux ne fournit qu'une image par publication (la première de la galerie). */
  images: string[];
  publishedAt: string | null;
}

const POST_URL = /facebook\.com\/groups\/(\d+)\/(?:posts|permalink)\/(\d+)/;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Extrait les publications exploitables d'un flux JSON rss.app.
 * Les éléments sans lien de groupe reconnaissable sont ignorés.
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
    const match = url.match(POST_URL);
    if (!match) continue;

    const authors = Array.isArray(item.authors) ? (item.authors as Record<string, unknown>[]) : [];
    const attachments = Array.isArray(item.attachments) ? (item.attachments as Record<string, unknown>[]) : [];
    const images = [asString(item.image), ...attachments.map((a) => asString(a?.url))].filter(Boolean);

    const date = asString(item.date_published);
    const time = date ? Date.parse(date) : NaN;

    posts.push({
      groupId: match[1],
      postId: match[2],
      url,
      author: asString(authors[0]?.name) || null,
      text: asString(item.content_text).trim(),
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
