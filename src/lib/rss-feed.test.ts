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
        groupId: "985585794841161",
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
    expect(posts.map((p) => `${p.groupId}/${p.postId}`)).toEqual(["222/2", "111/1", "111/3"]);
  });

  it("ignore les éléments sans lien de groupe et tolère les champs absents", () => {
    const posts = parseFeed({
      items: [
        item({ url: "https://www.facebook.com/somepage/posts/1" }),
        null,
        "texte",
        { url: "https://www.facebook.com/groups/5/posts/6/" },
      ],
    });
    expect(posts).toEqual([
      { groupId: "5", postId: "6", url: "https://www.facebook.com/groups/5/posts/6/", author: null, text: "", images: [], publishedAt: null },
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
