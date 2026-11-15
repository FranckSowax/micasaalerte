import type { Annonce } from "@/types/database";
import { formatPrice, getTypeBienLabel, getTypeOffreLabel } from "./utils";

interface MessageDetails {
  charges?: number | null;
  caution?: number | null;
  disponibilite?: string | null;
}

function annonceDetails(annonce: Annonce): MessageDetails {
  const d = (annonce as unknown as { details?: unknown }).details;
  return d && typeof d === "object" ? (d as MessageDetails) : {};
}

/**
 * Résumé groupé de plusieurs annonces (mode « résumé périodique »).
 * @example formatDigestMessage([annonce1, annonce2])
 */
export function formatDigestMessage(annonces: Annonce[]): string {
  const lines: string[] = [`*${annonces.length} annonce(s) correspondent à votre recherche*`, ""];
  annonces.forEach((a, i) => {
    const title = [a.type_offre ? getTypeOffreLabel(a.type_offre) : null, a.type_bien ? getTypeBienLabel(a.type_bien) : null]
      .filter(Boolean)
      .join(" - ");
    const place = [a.quartier, a.ville].filter(Boolean).join(", ");
    lines.push(`${i + 1}. ${title || "Annonce"}${a.prix ? ` — ${formatPrice(a.prix, a.devise)}` : ""}${place ? ` — ${place}` : ""}`);
    if (a.fb_post_url) lines.push(`   ${a.fb_post_url}`);
  });
  return lines.join("\n");
}

/**
 * Message d'alerte : un lien vers l'espace personnel du client, pas le détail des annonces.
 * WHY: un seul message court par heure au lieu d'une rafale d'annonces — moins intrusif pour
 * le client, et moins risqué pour un numéro relié à WAHA.
 *
 * @example formatClientLinkMessage({ name: "Awa", count: 3, link })
 */
export function formatClientLinkMessage(params: { name?: string | null; count?: number; link: string; renewed?: boolean; resend?: boolean }): string {
  const hello = params.name ? `Bonjour ${params.name},` : "Bonjour,";
  const lines = ["*Mi Casa Alerte*", "", hello];
  if (params.renewed) {
    lines.push("Voici votre nouveau lien personnel. L'ancien ne fonctionne plus.");
  } else if (params.resend) {
    lines.push("Voici le lien de votre espace personnel.");
  } else {
    const n = params.count || 0;
    lines.push(n > 1 ? `${n} nouvelles annonces correspondent à votre recherche.` : "Une nouvelle annonce correspond à votre recherche.");
  }
  lines.push("", "Consultez-les, contactez l'annonceur et triez-les ici :", params.link, "", "Ce lien est personnel : il ne fonctionne que sur votre appareil.");
  return lines.join("\n");
}

/**
 * Message de fin d'accès (essai ou abonnement) : invite à renouveler depuis l'espace client.
 *
 * @example formatAccessEndedMessage({ name: "Awa", trial: true, link, price: 1000, days: 2 })
 */
export function formatAccessEndedMessage(params: { name?: string | null; trial: boolean; link: string; price: number; days: number }): string {
  const hello = params.name ? `Bonjour ${params.name},` : "Bonjour,";
  return [
    "*Mi Casa Alerte*",
    "",
    hello,
    params.trial ? "Votre essai gratuit de 24 h est terminé." : "Votre abonnement est terminé.",
    `Pour continuer à recevoir les annonces : ${params.price.toLocaleString("fr-FR")} FCFA pour ${params.days} jours.`,
    "",
    "Renouvelez depuis votre espace :",
    params.link,
  ].join("\n");
}

/**
 * Confirmation d'un paiement validé, avec la nouvelle date de fin.
 *
 * @example formatSubscriptionActivatedMessage({ name: "Awa", until: "mardi 17 novembre à 13:00", link })
 */
export function formatSubscriptionActivatedMessage(params: { name?: string | null; until: string; link: string }): string {
  const hello = params.name ? `Bonjour ${params.name},` : "Bonjour,";
  return [
    "*Mi Casa Alerte*",
    "",
    hello,
    "Votre paiement est validé, merci.",
    `Vous recevez les annonces jusqu'au ${params.until}.`,
    "",
    "Votre espace :",
    params.link,
  ].join("\n");
}

export function formatAnnonceMessage(annonce: Annonce): string {
  const lines: string[] = [];

  lines.push("*Nouvelle annonce immobiliere*");
  lines.push("");

  if (annonce.type_offre || annonce.type_bien) {
    const parts: string[] = [];
    if (annonce.type_offre) parts.push(`*${getTypeOffreLabel(annonce.type_offre)}*`);
    if (annonce.type_bien) parts.push(getTypeBienLabel(annonce.type_bien));
    lines.push(parts.join(" - "));
  }

  if (annonce.prix) {
    lines.push(`Prix : ${formatPrice(annonce.prix, annonce.devise)}`);
  }

  if (annonce.quartier || annonce.ville) {
    lines.push(`Lieu : ${[annonce.quartier, annonce.ville].filter(Boolean).join(", ")}`);
  }

  const details: string[] = [];
  if (annonce.nb_chambres) details.push(`${annonce.nb_chambres} chambre(s)`);
  if (annonce.nb_pieces) details.push(`${annonce.nb_pieces} piece(s)`);
  if (annonce.superficie) details.push(`${annonce.superficie} m2`);
  if (details.length) lines.push(details.join(" | "));

  if (annonce.meuble) lines.push("Meuble");

  lines.push("");

  if (annonce.ai_summary) {
    lines.push(annonce.ai_summary);
    lines.push("");
  }

  const extra = annonceDetails(annonce);
  if (extra.charges) lines.push(`Charges : ${formatPrice(extra.charges, annonce.devise)}`);
  if (extra.caution) lines.push(`Caution : ${formatPrice(extra.caution, annonce.devise)}`);
  if (extra.disponibilite) lines.push(`Disponibilité : ${extra.disponibilite}`);

  if (annonce.telephone) lines.push(`Contact : ${annonce.telephone}`);
  // Aucun contact publié : on renvoie vers l'annonce, sans chercher à en deviner un.
  if (!annonce.telephone && !annonce.whatsapp && annonce.fb_post_url) lines.push("Contact : via l'annonce (lien ci-dessous)");
  if (annonce.whatsapp) lines.push(`WhatsApp : ${annonce.whatsapp}`);

  if (annonce.fb_post_url) {
    lines.push("");
    lines.push(`Voir l'annonce : ${annonce.fb_post_url}`);
  }

  if (annonce.ai_tags?.length) {
    lines.push("");
    lines.push(`Tags : ${annonce.ai_tags.join(", ")}`);
  }

  return lines.join("\n");
}

// ============================================================
// Envoi via WAHA (WhatsApp HTTP API auto-hébergée) — https://waha.devlike.pro
// Un seul serveur WAHA et une seule session pour toute l'application,
// configurés par variables d'environnement.
// ============================================================

const WAHA_TIMEOUT_MS = 30_000;

interface WahaConfig {
  baseUrl: string;
  apiKey: string;
  session: string;
}

function getWahaConfig(): WahaConfig | null {
  const baseUrl = process.env.WAHA_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.WAHA_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, session: process.env.WAHA_SESSION || "default" };
}

/** Indique si le serveur WAHA est configuré (WAHA_API_URL et WAHA_API_KEY). */
export function isWahaConfigured(): boolean {
  return getWahaConfig() !== null;
}

/** Nom de la session WAHA utilisée par l'application. */
export function getWahaSession(): string {
  return process.env.WAHA_SESSION || "default";
}

/**
 * Convertit un destinataire en identifiant de conversation WAHA.
 * - déjà un identifiant (`...@c.us`, `...@g.us`, `...@newsletter`, `...@lid`) : inchangé
 * - numéro de téléphone : chiffres seuls + `@c.us` (ou `@g.us` pour un groupe)
 *
 * @example toChatId("+241 77 12 34 56") // "24177123456@c.us"
 */
export function toChatId(recipient: string, options: { group?: boolean } = {}): string {
  const value = recipient.trim();
  if (value.includes("@")) return value;
  return `${value.replace(/\D/g, "")}@${options.group ? "g.us" : "c.us"}`;
}

/** Appel authentifié à l'API WAHA. Lève une erreur si WAHA n'est pas configuré. */
export async function wahaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = getWahaConfig();
  if (!config) throw new Error("WAHA non configuré (WAHA_API_URL / WAHA_API_KEY)");

  return fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Api-Key": config.apiKey,
      ...init.headers,
    },
    signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
  });
}

// WHY: la forme de l'identifiant renvoyé dépend du moteur WAHA (WEBJS, NOWEB, GOWS).
function extractMessageId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.id === "string") return d.id;
  const nestedId = d.id as Record<string, unknown> | undefined;
  if (nestedId && typeof nestedId._serialized === "string") return nestedId._serialized;
  if (nestedId && typeof nestedId.id === "string") return nestedId.id;
  const key = d.key as Record<string, unknown> | undefined;
  if (key && typeof key.id === "string") return key.id;
  return undefined;
}

/**
 * Envoie un message texte WhatsApp via WAHA. Ne lève jamais d'erreur :
 * l'échec est renvoyé dans le résultat pour être journalisé par l'appelant.
 *
 * @example
 * await sendWhatsAppMessage("+24177123456", "Bonjour");
 * await sendWhatsAppMessage("120363012345678901", "Annonce", { group: true });
 */
export async function sendWhatsAppMessage(
  recipient: string,
  message: string,
  options: { group?: boolean } = {}
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const config = getWahaConfig();
  if (!config) return { success: false, error: "WAHA non configuré" };

  const chatId = toChatId(recipient, options);
  if (chatId.startsWith("@")) return { success: false, error: "Destinataire invalide" };

  try {
    const response = await wahaFetch("/api/sendText", {
      method: "POST",
      body: JSON.stringify({ session: config.session, chatId, text: message }),
    });

    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const d = (data ?? {}) as Record<string, unknown>;
      const detail = typeof d.message === "string" ? d.message : typeof d.error === "string" ? d.error : "";
      return { success: false, error: `WAHA ${response.status}${detail ? ` : ${detail}` : ""}` };
    }

    return { success: true, messageId: extractMessageId(data) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "erreur inconnue";
    return { success: false, error: `WAHA injoignable : ${reason}` };
  }
}

export function annonceMatchesFilter(
  annonce: Annonce,
  filter: {
    filter_type_offre: string[];
    filter_type_bien: string[];
    filter_prix_min: number | null;
    filter_prix_max: number | null;
    filter_quartiers: string[];
    filter_ville: string | null;
  }
): boolean {
  if (filter.filter_type_offre?.length && annonce.type_offre) {
    if (!filter.filter_type_offre.includes(annonce.type_offre)) return false;
  }
  if (filter.filter_type_bien?.length && annonce.type_bien) {
    if (!filter.filter_type_bien.includes(annonce.type_bien)) return false;
  }
  if (filter.filter_prix_min && annonce.prix) {
    if (annonce.prix < filter.filter_prix_min) return false;
  }
  if (filter.filter_prix_max && annonce.prix) {
    if (annonce.prix > filter.filter_prix_max) return false;
  }
  if (filter.filter_quartiers?.length && annonce.quartier) {
    if (!filter.filter_quartiers.some((q) => annonce.quartier?.toLowerCase().includes(q.toLowerCase()))) return false;
  }
  if (filter.filter_ville && annonce.ville) {
    if (annonce.ville.toLowerCase() !== filter.filter_ville.toLowerCase()) return false;
  }
  return true;
}
