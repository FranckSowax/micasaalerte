// Lecture d'un flux rss.app (format JSON Feed) de sources Facebook.
// Un flux peut être un « bundle » mêlant plusieurs groupes ou plusieurs profils
// d'agents : chaque publication est rattachée à sa source grâce à son lien.

export interface FeedPost {
  /** Type de source : publication d'un groupe, ou d'un profil / d'une page. */
  kind: "group" | "profile";
  /** Identifiant Facebook de la source : identifiant du groupe, ou identifiant / nom d'utilisateur du profil. */
  sourceId: string;
  /** Identifiant Facebook de la publication, tiré du lien. */
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

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function locate(url: string): Pick<FeedPost, "kind" | "sourceId" | "postId"> | null {
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
 * Les éléments dont le lien ne désigne ni un groupe ni un profil sont ignorés.
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
