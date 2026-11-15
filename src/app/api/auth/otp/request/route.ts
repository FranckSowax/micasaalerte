import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { formatLoginCodeMessage, generateCode, isValidPhone, normalizePhone, OTP_COOKIE, OTP_TTL_MS, sealChallenge } from "@/lib/login-otp";
import { findAgentByPhone, otpSecret } from "@/lib/login-otp-server";
import { checkRateLimit, getClientIp } from "@/lib/request-limit";
import { isWahaConfigured, sendWhatsAppMessage } from "@/lib/whatsapp";

// Connexion de l'agent, étape 1 : envoi d'un code à 6 chiffres sur son WhatsApp.
// Seuls les numéros enregistrés dans Paramètres reçoivent un code.

export const dynamic = "force-dynamic";

const PER_PHONE = 3; // codes par quart d'heure et par numéro : évite d'inonder un WhatsApp
const PER_IP = 10;
const QUARTER_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;

const SIGNUPS_PER_HOUR = 40; // tous visiteurs confondus : l'inscription écrit à des numéros inconnus

const RequestSchema = z.object({
  phone: z.string().max(30),
  // Inscription : nom du nouvel agent. Absent pour une simple connexion.
  name: z.string().trim().min(2).max(80).optional(),
});

// Réponse identique que le numéro soit enregistré ou non : on ne révèle pas qui a un compte.
const GENERIC = { success: true, message: "Si ce numéro est enregistré, un code vient d'être envoyé sur WhatsApp." };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success && typeof body?.name === "string") {
    return NextResponse.json({ error: "Indiquez votre nom (2 à 80 caractères) et votre numéro WhatsApp." }, { status: 400 });
  }
  const phone = normalizePhone(parsed.success ? parsed.data.phone : "");
  if (!isValidPhone(phone)) return NextResponse.json({ error: "Numéro WhatsApp invalide" }, { status: 400 });
  const signupName = parsed.success ? parsed.data.name : undefined;

  const byIp = checkRateLimit(`otp:ip:${getClientIp(request)}`, PER_IP, HOUR_MS);
  const byPhone = checkRateLimit(`otp:phone:${phone}`, PER_PHONE, QUARTER_MS);
  if (!byIp.allowed || !byPhone.allowed) {
    return NextResponse.json({ error: "Trop de demandes. Réessayez dans quelques minutes." }, { status: 429 });
  }

  const secret = otpSecret();
  if (!secret || !isWahaConfigured()) {
    return NextResponse.json({ error: "Connexion par WhatsApp indisponible. Utilisez l'email." }, { status: 503 });
  }

  if (signupName && !checkRateLimit("otp:signup:global", SIGNUPS_PER_HOUR, HOUR_MS).allowed) {
    return NextResponse.json({ error: "Trop d'inscriptions en cours. Réessayez plus tard." }, { status: 429 });
  }

  const agent = await findAgentByPhone(phone);
  const code = generateCode();
  const { cookie } = sealChallenge(phone, code, secret, Date.now(), signupName);

  // Inscription : le code part vers tout numéro valide, c'est lui qui prouve que le numéro
  // appartient bien à la personne. Connexion : seulement vers un numéro déjà enregistré.
  if (agent || signupName) {
    const sent = await sendWhatsAppMessage(phone, formatLoginCodeMessage(code));
    // WHY: on prévient plutôt que de laisser l'agent attendre un code qui ne viendra pas ;
    // cela ne trahit l'existence du compte que pendant une panne de WhatsApp.
    if (!sent.success) {
      return NextResponse.json({ error: "WhatsApp ne répond pas. Utilisez la connexion par email." }, { status: 502 });
    }
  }
  // Numéro inconnu : un défi est posé quand même, avec un code que personne ne reçoit.

  cookies().set(OTP_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(OTP_TTL_MS / 1000),
  });
  return NextResponse.json(signupName ? { success: true, message: "Un code vient d'être envoyé sur votre WhatsApp." } : GENERIC);
}
