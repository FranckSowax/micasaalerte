import { createHmac } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizePhone } from "./login-otp";

// Partie serveur de la connexion par code WhatsApp : secret de signature et recherche de l'agent.

export interface OtpAgent {
  id: string;
  email: string;
}

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

  const matches = data.filter((p) => normalizePhone(p.whatsapp_phone as string | null) === phone);
  if (matches.length !== 1) return null;

  const id = matches[0].id as string;
  let email = (matches[0].email as string | null) || null;
  if (!email) {
    const { data: found } = await service.auth.admin.getUserById(id);
    email = found?.user?.email || null;
  }
  return email ? { id, email } : null;
}
