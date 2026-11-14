import { describe, expect, it } from "vitest";
import { isCopyablePhoto, isStoredPhoto, photoPath } from "./photos";

const BASE = "https://exemple.supabase.co";

describe("isStoredPhoto", () => {
  it("reconnaît une copie dans notre stockage", () => {
    expect(isStoredPhoto(`${BASE}/storage/v1/object/public/annonces/u/a/abc.jpg`, BASE)).toBe(true);
  });

  it("ne confond pas un lien Facebook avec une copie", () => {
    expect(isStoredPhoto("https://scontent.xx.fbcdn.net/v/t39/photo.jpg?oe=691D", BASE)).toBe(false);
  });
});

describe("isCopyablePhoto", () => {
  it("accepte les serveurs d'images Facebook et TikTok en HTTPS", () => {
    expect(isCopyablePhoto("https://scontent.xx.fbcdn.net/v/photo.jpg?oe=1")).toBe(true);
    expect(isCopyablePhoto("https://scontent.fdel29-1.fna.fbcdn.net/v/photo.jpg")).toBe(true);
    expect(isCopyablePhoto("https://p16-sign.tiktokcdn-eu.com/obj/cover.jpeg?x-expires=1")).toBe(true);
    expect(isCopyablePhoto("https://p16.tiktokcdn.com/obj/cover.jpeg")).toBe(true);
  });

  it("refuse les autres adresses", () => {
    expect(isCopyablePhoto("http://scontent.xx.fbcdn.net/v/photo.jpg")).toBe(false);
    expect(isCopyablePhoto("https://fbcdn.net.exemple.com/photo.jpg")).toBe(false);
    expect(isCopyablePhoto("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isCopyablePhoto("pas une adresse")).toBe(false);
  });
});

describe("photoPath", () => {
  it("ne dépend pas de la signature du lien, qui change à chaque lecture du flux", () => {
    const a = photoPath("u1", "a1", "https://scontent.xx.fbcdn.net/v/photo.jpg?oe=AAA", "image/jpeg");
    const b = photoPath("u1", "a1", "https://scontent.xx.fbcdn.net/v/photo.jpg?oe=BBB", "image/jpeg");
    expect(a).toBe(b);
    expect(a).toMatch(/^u1\/a1\/[0-9a-f]{16}\.jpg$/);
  });

  it("choisit l'extension d'après le type du fichier", () => {
    expect(photoPath("u", "a", "https://x.fbcdn.net/p", "image/webp")).toMatch(/\.webp$/);
    expect(photoPath("u", "a", "https://x.fbcdn.net/p", "image/png; charset=binary")).toMatch(/\.png$/);
  });
});
