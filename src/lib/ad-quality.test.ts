import { describe, expect, it } from "vitest";
import { analysePost, DEFAULT_CHECK_CONFIG, extractPrice, postText, suspicionScore, type ScraperPost } from "./ad-quality";

const album = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "photo", image_file_uri: `https://x.fbcdn.net/${i}.jpg`, id: String(i) }));

const COMPLETE: ScraperPost = {
  post_id: "1",
  url: "https://www.facebook.com/groups/1/posts/1/",
  message:
    "À louer à Angondjé : bel appartement de 3 chambres, salon spacieux, cuisine équipée, 2 douches, parking sécurisé et forage. Loyer 350 000 FCFA par mois. Contact : 077 12 34 56.",
  album_preview: album(5),
  images_count: 5,
};

describe("analysePost", () => {
  it("valide une annonce complète", () => {
    const r = analysePost(COMPLETE);
    expect(r.status).toBe("OK");
    expect(r.issues).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.extracted.price).toBe(350000);
    expect(r.extracted.currency).toBe("XAF");
    expect(r.extracted.phones).toEqual(["+24177123456"]);
    expect(r.extracted.location).toBeTruthy();
    expect(r.extracted.photoCount).toBe(5);
  });

  it("signale un texte terminé par « … »", () => {
    const r = analysePost({ ...COMPLETE, message: "Appartement 3 chambres à louer à Angondjé, loyer 350 000 FCFA, contact 077 12 34 56, salon et cuisine…" });
    expect(r.issues).toContain("TRUNCATED");
    expect(r.labels).toContain("Texte tronqué");
    expect(r.status).not.toBe("OK");
  });

  it("signale une annonce sans photo", () => {
    const r = analysePost({ ...COMPLETE, album_preview: null, images_count: 0 });
    expect(r.issues).toEqual(["NO_PHOTO"]);
    expect(r.score).toBe(70);
    expect(r.status).toBe("INCOMPLETE");
  });

  it("rejette un texte tronqué sans photo", () => {
    const r = analysePost({ post_id: "2", message: "Studio à louer à Okala, propre et bien situé, voir plus", album_preview: null });
    expect(r.issues).toEqual(expect.arrayContaining(["TRUNCATED", "NO_PHOTO"]));
    expect(r.status).toBe("REJECTED");
  });

  it("signale un prix manquant", () => {
    const r = analysePost({ ...COMPLETE, message: COMPLETE.message!.replace("Loyer 350 000 FCFA par mois. ", "") });
    expect(r.issues).toEqual(["MISSING_PRICE"]);
    expect(r.labels).toEqual(["Prix manquant"]);
    expect(r.score).toBe(85);
  });

  it("traite « MP » comme un contact faible (avertissement)", () => {
    const r = analysePost({ ...COMPLETE, message: COMPLETE.message!.replace("Contact : 077 12 34 56.", "Écrivez-moi en MP.") });
    expect(r.issues).toEqual(["WEAK_CONTACT"]);
    expect(r.labels).toEqual(["Contact par message privé uniquement"]);
    expect(r.status).toBe("OK");
  });

  it("écarte une demande (pas une annonce)", () => {
    const r = analysePost({ post_id: "3", message: "Bonjour, je cherche un studio à Nzeng-Ayong pour 80 000 maximum, qui a ?" });
    expect(r.status).toBe("NOT_AD");
    expect(r.issues).toEqual([]);
  });

  it("supporte un message nul : partage dont le texte est dans le post d'origine", () => {
    const shared = analysePost({ post_id: "4", message: null, attached_post: { message: COMPLETE.message, photo_url: "https://x.fbcdn.net/a.jpg" } });
    expect(shared.extracted.textLength).toBeGreaterThan(100);
    expect(shared.issues).not.toContain("MISSING_PRICE");

    const empty = analysePost({ post_id: "5", message: null });
    expect(empty.status).toBe("NOT_AD");
  });

  it("exige les champs propres à une catégorie quand on les demande", () => {
    const r = analysePost(COMPLETE, { ...DEFAULT_CHECK_CONFIG, requiredFields: ["PRICE", "LOCATION", "CONTACT", "DESCRIPTION", "ROOMS", "SURFACE"] });
    expect(r.issues).toEqual(["MISSING_SURFACE"]);
  });
});

describe("extractPrice", () => {
  it("lit les montants courants", () => {
    expect(extractPrice("Loyer 150.000 F").price).toBe(150000);
    expect(extractPrice("Prix : 2,5M").price).toBe(2500000);
    expect(extractPrice("prix: 150k à débattre").price).toBe(150000);
    expect(extractPrice("Loyer à débattre").mentioned).toBe(true);
    expect(extractPrice("Belle villa 4 chambres").mentioned).toBe(false);
  });
});

describe("postText", () => {
  it("préfère le message propre au post partagé", () => {
    expect(postText({ message: "mon texte", attached_post: { message: "autre" } })).toBe("mon texte");
    expect(postText({ message: "  ", attached_post: { message: "autre" } })).toBe("autre");
  });
});

describe("suspicionScore", () => {
  it("note haut un texte court sans prix ni contact", () => {
    expect(suspicionScore({ raw_text: "Studio à louer", prix: null, quartier: null, telephone: null, whatsapp: null })).toBe(8);
    expect(suspicionScore({ raw_text: "x".repeat(300), prix: 100000, quartier: "Okala", telephone: "+24177000000", whatsapp: null })).toBe(0);
  });
});
