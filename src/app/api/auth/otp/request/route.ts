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

const RequestSchema = z.object({ phone: z.string().max(30) });

// Réponse identique que le numéro soit enregistré ou non : on ne révèle pas qui a un compte.
const GENERIC = { success: true, message: "Si ce numéro est enregistré, un code vient d'être envoyé sur WhatsApp." };

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  const phone = normalizePhone(parsed.success ? parsed.data.phone : "");
  if (!isValidPhone(phone)) return NextResponse.json({ error: "Numéro WhatsApp invalide" }, { status: 400 });

  const byIp = checkRateLimit(`otp:ip:${getClientIp(request)}`, PER_IP, HOUR_MS);
  const byPhone = checkRateLimit(`otp:phone:${phone}`, PER_PHONE, QUARTER_MS);
  if (!byIp.allowed || !byPhone.allowed) {
    return NextResponse.json({ error: "Trop de demandes. Réessayez dans quelques minutes." }, { status: 429 });
  }

  const secret = otpSecret();
  if (!secret || !isWahaConfigured()) {
    return NextResponse.json({ error: "Connexion par WhatsApp indisponible. Utilisez l'email." }, { status: 503 });
  }

  const agent = await findAgentByPhone(phone);
  const code = generateCode();
  const { cookie } = sealChallenge(phone, code, secret);

  if (agent) {
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
  return NextResponse.json(GENERIC);
}
