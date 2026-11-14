import { afterEach, describe, expect, it } from "vitest";
import { configuredFeedUrls, parseFeed } from "./rss-feed";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "abc",
  url: "https://www.facebook.com/groups/985585794841161/posts/29392345270405167/",
  title: "STUDIO",
  content_text: "  STUDIO BON STANDING LOUER ANGONDJÉ 150k 062090802  ",
  image: "https://scontent.example/a.jpg",
  attachments: [{ url: "https://scontent.example/a.jpg" }],
  date_published: "2026-11-14T18:55:00.000Z",
  authors: [{ name: "LEWIS IMMO" }],
  ...overrides,
});

describe("parseFeed", () => {
  it("extrait groupe, publication, auteur, texte, image et date", () => {
    expect(parseFeed({ items: [item()] })).toEqual([
      {
        kind: "group",
        sourceId: "985585794841161",
        postId: "29392345270405167",
        url: "https://www.facebook.com/groups/985585794841161/posts/29392345270405167/",
        author: "LEWIS IMMO",
        text: "STUDIO BON STANDING LOUER ANGONDJÉ 150k 062090802",
        images: ["https://scontent.example/a.jpg"],
        publishedAt: "2026-11-14T18:55:00.000Z",
      },
    ]);
  });

  it("rattache chaque publication d'un bundle à son groupe et trie du plus ancien au plus récent", () => {
    const posts = parseFeed({
      items: [
        item({ url: "https://www.facebook.com/groups/111/posts/3/", date_published: "2026-11-14T19:00:00Z" }),
        item({ url: "https://www.facebook.com/groups/222/permalink/2/", date_published: "2026-11-14T17:00:00Z" }),
        item({ url: "https://www.facebook.com/groups/111/posts/1/", date_published: "2026-11-14T18:00:00Z" }),
      ],
    });
    expect(posts.map((p) => `${p.sourceId}/${p.postId}`)).toEqual(["222/2", "111/1", "111/3"]);
  });

  it("ignore les éléments sans lien de groupe et tolère les champs absents", () => {
    const posts = parseFeed({
      items: [
        item({ url: "https://www.facebook.com/watch/?v=123" }),
        null,
        "texte",
        { url: "https://www.facebook.com/groups/5/posts/6/" },
      ],
    });
    expect(posts).toEqual([
      { kind: "group", sourceId: "5", postId: "6", url: "https://www.facebook.com/groups/5/posts/6/", author: null, text: "", images: [], publishedAt: null },
    ]);
  });

  it("reconnaît les publications de profils et de pages d'agents", () => {
    const posts = parseFeed({
      items: [
        item({ url: "https://m.facebook.com/permalink.php?id=100067401866344&story_fbid=pfbid0N4d2AdN", date_published: "2026-11-14T10:00:00Z" }),
        item({ url: "https://m.facebook.com/permalink.php?story_fbid=pfbid0ZZ&id=100063558637554", date_published: "2026-11-14T11:00:00Z" }),
        item({ url: "https://m.facebook.com/joshua.houenassou.1/posts/pfbid0TqgHBBF", date_published: "2026-11-14T12:00:00Z" }),
      ],
    });
    expect(posts.map((p) => [p.kind, p.sourceId, p.postId])).toEqual([
      ["profile", "100067401866344", "pfbid0N4d2AdN"],
      ["profile", "100063558637554", "pfbid0ZZ"],
      ["profile", "joshua.houenassou.1", "pfbid0TqgHBBF"],
    ]);
  });

  it("renvoie une liste vide pour un flux mal formé", () => {
    expect(parseFeed(null)).toEqual([]);
    expect(parseFeed({ items: "x" })).toEqual([]);
    expect(parseFeed({})).toEqual([]);
  });
});

describe("configuredFeedUrls", () => {
  const previous = process.env.RSS_FEED_URLS;
  afterEach(() => {
    process.env.RSS_FEED_URLS = previous;
  });

  it("accepte plusieurs adresses https séparées par virgules ou espaces", () => {
    process.env.RSS_FEED_URLS = "https://rss.app/feeds/v1.1/a.json, https://rss.app/feeds/v1.1/b.json\nhttp://insecure/x ftp://y";
    expect(configuredFeedUrls()).toEqual(["https://rss.app/feeds/v1.1/a.json", "https://rss.app/feeds/v1.1/b.json"]);
  });

  it("renvoie une liste vide sans configuration", () => {
    delete process.env.RSS_FEED_URLS;
    expect(configuredFeedUrls()).toEqual([]);
  });
});
