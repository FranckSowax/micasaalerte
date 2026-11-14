import type { Annonce } from "@/types/database";
import { formatPrice, getTypeBienLabel, getTypeOffreLabel } from "./utils";

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
    lines.push(`Quartier : ${annonce.quartier ? `${annonce.quartier}, ` : ""}${annonce.ville}`);
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

  if (annonce.telephone) lines.push(`Contact : ${annonce.telephone}`);
  if (annonce.whatsapp) lines.push(`WhatsApp : ${annonce.whatsapp}`);

  if (annonce.fb_post_url) {
    lines.push("");
    lines.push(`Voir sur Facebook : ${annonce.fb_post_url}`);
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
