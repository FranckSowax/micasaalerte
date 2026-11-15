import { createHmac } from "crypto";
import type { createServiceClient } from "@/lib/supabase/server";

// Paiement d'un abonnement par Airtel Money, chez le marchand Moutouki Shop.
// Chaque paiement porte une référence de commande, générée ici et saisie par l'abonné dans le
// menu Airtel Money : c'est elle qui permet à l'agent de rattacher un encaissement à un abonné.
// WHY: la référence est calculée, pas tirée au hasard puis stockée. Elle reste la même tant que
// le paiement en cours n'est pas traité (l'abonné peut fermer puis rouvrir la page), et change
// à chaque nouveau paiement : un réabonnement a toujours sa propre référence.

type Client = ReturnType<typeof createServiceClient>;

const PREFIX = "MCA";

export interface PaymentMerchant {
  operator: string;
  /** Code à composer pour ouvrir le menu de paiement. */
  ussd: string;
  /** Code marchand à saisir dans le menu. */
  code: string;
  name: string;
  /** Numéro à appeler en cas de difficulté de paiement. */
  contact: string;
}

/** Coordonnées du marchand, modifiables par variables d'environnement sans toucher au code. */
export function paymentMerchant(env: Record<string, string | undefined> = process.env): PaymentMerchant {
  return {
    operator: "Airtel Money",
    ussd: "*150#",
    code: env.PAYMENT_MERCHANT_CODE?.trim() || "M5309",
    name: env.PAYMENT_MERCHANT_NAME?.trim() || "Moutouki Shop",
    contact: env.PAYMENT_CONTACT_PHONE?.trim() || "077 24 72 45",
  };
}

/**
 * Référence de commande : « MCA » suivi de 6 chiffres, facile à saisir sur un clavier de téléphone.
 * Elle dépend de l'abonné et du rang du paiement (0 pour le premier, 1 pour le suivant…).
 *
 * @example orderReference(demand.id, 0, secret) // "MCA482913"
 */
export function orderReference(demandId: string, sequence: number, secret: string): string {
  const digest = createHmac("sha256", secret).update(`${demandId}:${sequence}`).digest();
  const number = digest.readUInt32BE(0) % 1_000_000;
  return `${PREFIX}${String(number).padStart(6, "0")}`;
}

/** Une référence a-t-elle la forme attendue ? */
export function isOrderReference(value: string | null | undefined): boolean {
  return /^MCA\d{6}$/.test((value || "").trim().toUpperCase());
}

/** Secret de calcul des références, dérivé de la clé service Supabase (jamais exposée au navigateur). */
export function paymentSecret(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key ? createHmac("sha256", key).update("mca-order-reference").digest("hex") : null;
}

/**
 * Référence du paiement en cours pour un abonné. Son rang est le nombre de paiements déjà
 * traités (validés ou refusés) : tant que rien n'est traité, la référence ne change pas.
 * Null si le secret manque. Table des paiements absente : rang 0.
 *
 * @example const reference = await currentOrderReference(supabase, demand.id)
 */
export async function currentOrderReference(supabase: Client, demandId: string): Promise<string | null> {
  const secret = paymentSecret();
  if (!secret) return null;
  const { count } = await supabase
    .from("subscription_payments")
    .select("id", { count: "exact", head: true })
    .eq("demand_id", demandId)
    .in("status", ["confirmed", "rejected"]);
  return orderReference(demandId, count ?? 0, secret);
}
