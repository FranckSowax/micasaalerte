import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { formatLoginCodeMessage, generateCode, isValidPhone, normalizePhone, OTP_COOKIE, OTP_TTL_MS, sealChallenge } from "@/lib/login-otp";
import { clientExists, findAgentByPhone, otpSecret } from "@/lib/login-otp-server";
import { checkRateLimit, getClientIp } from "@/lib/request-limit";
import { isWahaConfigured, sendWhatsAppMessage } from "@/lib/whatsapp";

// Connexion, étape 1 : envoi d'un code à 6 chiffres sur WhatsApp.
// Reçoivent un code : l'agent (numéro de ses Paramètres) et l'abonné déjà inscrit.

export const dynamic = "force-dynamic";

const PER_PHONE = 3; // codes par quart d'heure et par numéro : évite d'inonder un WhatsApp
const PER_IP = 10;
const QUARTER_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;

const SIGNUPS_PER_HOUR = 60; // tous visiteurs confondus : l'inscription écrit à des numéros inconnus

const RequestSchema = z.object({
  phone: z.string().max(30),
  // Inscription d'un nouvel abonné : le code part vers un numéro encore inconnu, pour prouver qu'il est bien le sien.
  signup: z.boolean().optional(),
});

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
    return NextResponse.json({ error: "Connexion par WhatsApp indisponible pour le moment." }, { status: 503 });
  }

  const signup = parsed.success && parsed.data.signup === true;
  const isClient = await clientExists(phone);
  if (signup) {
    if (isClient) {
      return NextResponse.json(
        { error: "Ce numéro est déjà inscrit. Connectez-vous pour ouvrir votre espace.", code: "exists" },
        { status: 409 }
      );
    }
    if (!checkRateLimit("otp:signup:global", SIGNUPS_PER_HOUR, HOUR_MS).allowed) {
      return NextResponse.json({ error: "Trop d'inscriptions en cours. Réessayez plus tard." }, { status: 429 });
    }
  }

  const known = signup || isClient || (await findAgentByPhone(phone)) !== null;
  const code = generateCode();
  const { cookie } = sealChallenge(phone, code, secret);

  if (known) {
    const sent = await sendWhatsAppMessage(phone, formatLoginCodeMessage(code));
    // WHY: on prévient plutôt que de laisser la personne attendre un code qui ne viendra pas ;
    // cela ne trahit l'existence du compte que pendant une panne de WhatsApp.
    if (!sent.success) {
      return NextResponse.json({ error: "WhatsApp ne répond pas. Réessayez dans quelques minutes." }, { status: 502 });
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
  return NextResponse.json(signup ? { success: true, message: "Un code vient d'être envoyé sur votre WhatsApp." } : GENERIC);
}
