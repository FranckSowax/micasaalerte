import { createHmac } from "crypto";
import { publicBaseUrl } from "@/lib/client-access";
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

/** Profils portant ce numéro WhatsApp. Null si la lecture échoue. */
async function profilesByPhone(phone: string) {
  const service = createServiceClient();
  const { data, error } = await service.from("profiles").select("id, email, whatsapp_phone").not("whatsapp_phone", "is", null).limit(1000);
  if (error || !data) return null;
  return data.filter((p) => normalizePhone(p.whatsapp_phone as string | null) === phone);
}

/** Nombre de comptes portant ce numéro ; null si la lecture échoue (on ne crée alors rien). */
export async function countAgentsByPhone(phone: string): Promise<number | null> {
  const matches = await profilesByPhone(phone);
  return matches ? matches.length : null;
}

/** Domaine des adresses techniques des comptes créés par WhatsApp (aucun email n'y est envoyé). */
function signupEmailDomain(): string {
  const configured = process.env.SIGNUP_EMAIL_DOMAIN?.trim();
  if (configured) return configured;
  try {
    const host = new URL(publicBaseUrl()).hostname;
    if (host && host !== "localhost" && host.includes(".")) return host;
  } catch {
    // adresse publique absente : domaine par défaut ci-dessous
  }
  return "whatsapp.micasaalerte.app";
}

/**
 * Crée le compte d'un agent inscrit par WhatsApp, numéro déjà vérifié par le code.
 * WHY: Supabase exige un email par compte. On lui donne une adresse technique dérivée du numéro,
 * jamais utilisée pour écrire à l'agent : il se connecte toujours par code WhatsApp.
 *
 * @example const agent = await createAgent("24177123456", "Awa Ndong")
 */
export async function createAgent(phone: string, name: string): Promise<OtpAgent | null> {
  const service = createServiceClient();
  const email = `wa-${phone}@${signupEmailDomain()}`;
  const whatsappPhone = `+${phone}`;

  const { data, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: name, whatsapp_phone: whatsappPhone },
  });
  const id = data?.user?.id;
  if (error || !id) {
    console.error("WhatsApp signup failed:", error?.message);
    return null;
  }

  // Le déclencheur handle_new_user a créé le profil ; on y inscrit le numéro, clé de la connexion.
  const { error: profileError } = await service
    .from("profiles")
    .upsert({ id, email, full_name: name, whatsapp_phone: whatsappPhone }, { onConflict: "id" });
  if (profileError) {
    // Sans numéro dans le profil, le compte serait inaccessible : on l'annule.
    console.error("WhatsApp signup profile failed:", profileError.message);
    await service.auth.admin.deleteUser(id);
    return null;
  }
  return { id, email };
}

/**
 * Agent dont le numéro WhatsApp (Paramètres) correspond exactement au numéro saisi.
 * Null si aucun agent, ou plusieurs, portent ce numéro : dans le doute, on n'ouvre aucune session.
 *
 * @example const agent = await findAgentByPhone("24177123456")
 */
export async function findAgentByPhone(phone: string): Promise<OtpAgent | null> {
  const service = createServiceClient();
  const matches = await profilesByPhone(phone);
  if (!matches || matches.length !== 1) return null;

  const id = matches[0].id as string;
  let email = (matches[0].email as string | null) || null;
  if (!email) {
    const { data: found } = await service.auth.admin.getUserById(id);
    email = found?.user?.email || null;
  }
  return email ? { id, email } : null;
}
