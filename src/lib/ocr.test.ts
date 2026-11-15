import { describe, expect, it } from "vitest";
import { cleanImageText, IMAGE_TEXT_HEADING, imageTextOf, MAX_IMAGE_TEXT, pickImages, shouldReadImages, withImageText } from "./ocr";

const TIKTOK = "https://p16-sign-va.tiktokcdn.com/obj/cover.jpeg?x-expires=1";
const TIKTOK_EU = "https://p77-sign.tiktokcdn-eu.com/obj/photo2.webp";

describe("lecture du texte des images", () => {
  it("ne concerne que TikTok, avec une image d'un serveur autorisé", () => {
    expect(shouldReadImages({ sourceType: "tiktok", images: [TIKTOK] })).toBe(true);
    expect(shouldReadImages({ sourceType: "tiktok", images: [] })).toBe(false);
    expect(shouldReadImages({ sourceType: "tiktok", images: ["https://exemple.test/a.jpg"] })).toBe(false);
    expect(shouldReadImages({ sourceType: "group", images: ["https://scontent.xx.fbcdn.net/a.jpg"] })).toBe(false);
  });

  it("choisit au plus trois images autorisées, sans doublon de signature", () => {
    const picked = pickImages([TIKTOK, TIKTOK.replace("x-expires=1", "x-expires=2"), "http://p16.tiktokcdn.com/a.jpg", TIKTOK_EU, `${TIKTOK_EU}x`, "https://p16.tiktokcdn.com/c.jpg"]);
    expect(picked).toEqual([TIKTOK, TIKTOK_EU, `${TIKTOK_EU}x`]);
  });

  it("nettoie la transcription et reconnaît l'absence de texte", () => {
    expect(cleanImageText("```\nVILLA À LOUER\n\n\n  Okala  \n```")).toBe("VILLA À LOUER\nOkala");
    expect(cleanImageText("RIEN")).toBe("");
    expect(cleanImageText("Aucun texte.")).toBe("");
    expect(cleanImageText(null)).toBe("");
    expect(cleanImageText("x".repeat(3000))).toHaveLength(MAX_IMAGE_TEXT);
  });

  it("ajoute le texte lu à la légende, une seule fois, et le retrouve ensuite", () => {
    const text = withImageText("#immo #libreville", "STUDIO 150 000 F");
    expect(text).toBe(`#immo #libreville\n\n${IMAGE_TEXT_HEADING}\nSTUDIO 150 000 F`);
    expect(withImageText(text, "STUDIO 150 000 F")).toBe(text);
    expect(withImageText("", "STUDIO")).toBe(`${IMAGE_TEXT_HEADING}\nSTUDIO`);
    expect(withImageText("#immo", "")).toBe("#immo");
    expect(imageTextOf(text)).toBe("STUDIO 150 000 F");
    expect(imageTextOf("Studio à Okala")).toBe("");
  });
});
