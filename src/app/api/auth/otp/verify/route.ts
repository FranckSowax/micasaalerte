import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkCode, OTP_COOKIE, OTP_MAX_ATTEMPTS, OTP_TTL_MS, readChallenge } from "@/lib/login-otp";
import { findAgentByPhone, openClientSpace, otpSecret } from "@/lib/login-otp-server";
import { checkRateLimit, getClientIp } from "@/lib/request-limit";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Connexion, étape 2 : vérification du code reçu sur WhatsApp.
// - numéro d'un agent  → session Supabase (administration), redirection vers /dashboard ;
// - numéro d'un abonné → son espace client s'ouvre sur cet appareil, redirection vers /c/<lien>.

export const dynamic = "force-dynamic";

const PER_IP = 30;
const HOUR_MS = 60 * 60_000;

const VerifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

// Défis déjà utilisés : un code ne sert qu'une fois (mémoire du processus, comme le limiteur).
const usedNonces = new Set<string>();

// Le cookie du défi est effacé sur la réponse elle-même (API cookies asynchrone depuis Next 15).
const fail = (error: string, status: number, clear = false) => {
  const response = NextResponse.json({ error }, { status });
  if (clear) response.cookies.delete(OTP_COOKIE);
  return response;
};

const done = (nonce: string, redirect: string) => {
  usedNonces.add(nonce);
  if (usedNonces.size > 5000) usedNonces.clear();
  const response = NextResponse.json({ success: true, redirect });
  response.cookies.delete(OTP_COOKIE);
  return response;
};

export async function POST(request: Request) {
  const parsed = VerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Le code comporte 6 chiffres.", 400);

  const cookie = (await cookies()).get(OTP_COOKIE)?.value;
  const challenge = readChallenge(cookie);
  const secret = otpSecret();
  if (!challenge || !secret) return fail("Code expiré. Demandez un nouveau code.", 400, true);

  const byIp = checkRateLimit(`otp:verify:ip:${getClientIp(request)}`, PER_IP, HOUR_MS);
  const byChallenge = checkRateLimit(`otp:verify:${challenge.nonce}`, OTP_MAX_ATTEMPTS, OTP_TTL_MS);
  if (!byIp.allowed || !byChallenge.allowed) return fail("Trop d'essais. Demandez un nouveau code.", 429, true);

  const check = checkCode(cookie, parsed.data.code, secret);
  if (!check.ok) {
    return check.reason === "expired" ? fail("Code expiré. Demandez un nouveau code.", 401, true) : fail("Code incorrect.", 401);
  }
  if (usedNonces.has(challenge.nonce)) return fail("Code déjà utilisé. Demandez un nouveau code.", 401, true);

  const phone = check.challenge.phone;
  const agent = await findAgentByPhone(phone);

  if (!agent) {
    // Pas un agent : c'est un abonné, on ouvre son espace client sur cet appareil.
    const token = await openClientSpace(phone);
    if (!token) return fail("Code incorrect.", 401);
    return done(challenge.nonce, `/c/${token}`);
  }

  // WHY: Supabase n'ouvre pas de session « par numéro WhatsApp ». Le serveur fabrique un lien
  // magique à usage unique pour le compte de l'agent et le consomme aussitôt, sans jamais
  // l'envoyer : la session créée est une session Supabase ordinaire (RLS inchangée).
  const service = createServiceClient();
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email: agent.email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("OTP login link failed:", linkError?.message);
    return fail("Connexion impossible. Utilisez la connexion par email.", 500);
  }

  const supabase = await createClient();
  const { error: sessionError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (sessionError) {
    console.error("OTP login session failed:", sessionError.message);
    return fail("Connexion impossible. Utilisez la connexion par email.", 500);
  }

  return done(challenge.nonce, "/dashboard");
}
