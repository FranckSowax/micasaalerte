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

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  recipientPhone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipientPhone.replace(/\D/g, ""),
        type: "text",
        text: { body: message },
      }),
    }
  );

  const data = await response.json();

  if (data.messages?.[0]?.id) {
    return { success: true, messageId: data.messages[0].id };
  }

  return {
    success: false,
    error: data.error?.message || "Erreur inconnue WhatsApp",
  };
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
