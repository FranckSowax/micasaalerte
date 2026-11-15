import { createHmac } from "crypto";
import { generateAccessToken } from "@/lib/client-access";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizePhone } from "./login-otp";

// Partie serveur de la connexion par code WhatsApp : secret de signature, recherche de l'agent
// (administration) et de l'abonné (espace client).

export interface OtpAgent {
  id: string;
  email: string;
}

// Comptes créés par l'ancienne inscription WhatsApp (adresse technique wa-<numéro>@…) : ce ne
// sont pas des agents. Leur numéro est traité comme celui d'un abonné ordinaire.
const TECHNICAL_EMAIL = /^wa-\d+@/i;

/**
 * Secret de signature des défis, dérivé de la clé service Supabase (jamais exposée au navigateur).
 * WHY: évite une variable d'environnement de plus ; si la clé service change, les codes en
 * cours deviennent simplement invalides.
 */
export function otpSecret(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key ? createHmac("sha256", key).update("mca-login-otp").digest("hex") : null;
}

/**
 * Agent dont le numéro WhatsApp (Paramètres) correspond exactement au numéro saisi.
 * Null si aucun agent, ou plusieurs, portent ce numéro : dans le doute, on n'ouvre aucune session.
 *
 * @example const agent = await findAgentByPhone("24177123456")
 */
export async function findAgentByPhone(phone: string): Promise<OtpAgent | null> {
  const service = createServiceClient();
  const { data, error } = await service.from("profiles").select("id, email, whatsapp_phone").not("whatsapp_phone", "is", null).limit(1000);
  if (error || !data) return null;

  const matches = data.filter(
    (p) => normalizePhone(p.whatsapp_phone as string | null) === phone && !TECHNICAL_EMAIL.test((p.email as string | null) || "")
  );
  if (matches.length !== 1) return null;

  const id = matches[0].id as string;
  let email = (matches[0].email as string | null) || null;
  if (!email) {
    const { data: found } = await service.auth.admin.getUserById(id);
    email = found?.user?.email || null;
  }
  return email && !TECHNICAL_EMAIL.test(email) ? { id, email } : null;
}

/** Demande la plus récente d'un abonné pour ce numéro (enregistré en chiffres, parfois avec « + »). */
async function latestDemandId(phone: string): Promise<string | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("client_demands")
    .select("id")
    .in("client_phone", [phone, `+${phone}`])
    .order("created_at", { ascending: false })
    .limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}

/** Ce numéro est-il celui d'un abonné inscrit ? */
export async function clientExists(phone: string): Promise<boolean> {
  return (await latestDemandId(phone)) !== null;
}

/**
 * Ouvre l'espace d'un abonné sur l'appareil qui vient de saisir le bon code : nouveau lien
 * personnel, et l'appareil lié est oublié pour que celui-ci prenne sa place.
 * WHY: même règle que « recevoir un nouveau lien » — l'ancien lien cesse de fonctionner.
 *
 * @example const token = await openClientSpace("24177123456"); // puis rediriger vers /c/<token>
 */
export async function openClientSpace(phone: string): Promise<string | null> {
  const id = await latestDemandId(phone);
  if (!id) return null;
  const token = generateAccessToken();
  const { error } = await createServiceClient().from("client_demands").update({ access_token: token, device_hash: null }).eq("id", id);
  if (error) {
    console.error("OTP client space failed:", error.message);
    return null;
  }
  return token;
}
