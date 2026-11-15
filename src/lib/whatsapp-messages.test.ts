import { describe, expect, it } from "vitest";
import { formatClientLinkMessage, formatPaymentDeclaredMessage, formatSubscriptionActivatedMessage } from "./whatsapp";

describe("messages de paiement", () => {
  it("prévient l'agent avec le montant, la durée et la référence à retrouver", () => {
    const text = formatPaymentDeclaredMessage({ client: "Awa (24177000000)", amount: 5000, days: 7, reference: "MCA226047", link: "https://exemple.test/paiements" });
    expect(text).toContain("Awa (24177000000) déclare avoir payé 5");
    expect(text).toContain("(7 jours)");
    expect(text).toContain("*MCA226047*");
    expect(text).toContain("https://exemple.test/paiements");
  });

  it("à la validation, annonce la première sélection quand il y en a une", () => {
    const avec = formatSubscriptionActivatedMessage({ name: "Awa", until: "mardi 17 novembre à 13:00", link: "https://exemple.test/c/abc", count: 3 });
    expect(avec).toContain("Votre paiement est validé");
    expect(avec).toContain("3 annonces correspondent déjà à votre recherche.");
    expect(avec).toContain("Consultez-les ici :");

    const sans = formatSubscriptionActivatedMessage({ until: "mardi 17 novembre à 13:00", link: "https://exemple.test/c/abc" });
    expect(sans).not.toContain("correspond");
    expect(sans).toContain("Votre espace :");
  });
});

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
