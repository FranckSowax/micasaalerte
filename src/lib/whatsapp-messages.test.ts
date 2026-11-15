import { describe, expect, it } from "vitest";
import { formatClientLinkMessage } from "./whatsapp";

const link = "https://exemple.test/c/abc";

describe("message WhatsApp avec le lien de l'espace", () => {
  it("annonce les nouvelles annonces lors d'un passage horaire", () => {
    const text = formatClientLinkMessage({ name: "Awa", count: 3, link });
    expect(text).toContain("Bonjour Awa,");
    expect(text).toContain("3 nouvelles annonces correspondent à votre recherche.");
    expect(text).toContain(link);
  });

  it("à l'inscription, donne la première sélection", () => {
    const text = formatClientLinkMessage({ count: 4, link, welcome: true });
    expect(text).toContain("Votre alerte est active.");
    expect(text).toContain("4 annonces correspondent déjà à votre recherche.");
    expect(formatClientLinkMessage({ count: 1, link, welcome: true })).toContain("Une annonce correspond déjà à votre recherche.");
  });

  it("à l'inscription sans annonce, envoie quand même le lien sans promettre d'annonces", () => {
    const text = formatClientLinkMessage({ count: 0, link, welcome: true });
    expect(text).toContain("Aucune annonce ne correspond pour l'instant");
    expect(text).toContain("Votre espace personnel :");
    expect(text).not.toContain("Consultez-les");
    expect(text).toContain(link);
  });

  it("garde les messages de renvoi et de nouveau lien", () => {
    expect(formatClientLinkMessage({ link, resend: true })).toContain("Voici le lien de votre espace personnel.");
    expect(formatClientLinkMessage({ link, renewed: true })).toContain("L'ancien ne fonctionne plus.");
  });
});
