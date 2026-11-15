import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

// Connexion de l'agent par code à usage unique envoyé sur WhatsApp.
// WHY: aucun code n'est enregistré en base. Le défi (numéro, expiration, identifiant) est déposé
// dans un cookie signé ; la signature dépend du code, que seul WhatsApp transporte. Sans le code,
// le cookie ne permet ni de le retrouver ni d'en fabriquer un autre.

export const OTP_COOKIE = "mca_login_otp";
export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
const OTP_DIGITS = 6;

export interface OtpChallenge {
  /** Numéro saisi, chiffres seulement. */
  phone: string;
  /** Expiration, en millisecondes depuis l'époque Unix. */
  exp: number;
  /** Identifiant aléatoire du défi : compte les tentatives et empêche la réutilisation. */
  nonce: string;
  /** Présent pour une inscription : nom du nouvel agent, dont le compte est créé une fois le code validé. */
  signupName?: string;
}

/**
 * Numéro WhatsApp réduit à ses chiffres, sans préfixe international « 00 ».
 *
 * @example normalizePhone("+241 77 12 34 56") // "24177123456"
 */
export function normalizePhone(input: string | null | undefined): string {
  return (input || "").replace(/\D/g, "").replace(/^00/, "");
}

/** Un numéro plausible : 8 à 15 chiffres. */
export function isValidPhone(digits: string): boolean {
  return /^\d{8,15}$/.test(digits);
}

/** Code à 6 chiffres tiré d'un générateur cryptographique. */
export function generateCode(): string {
  return randomInt(0, 10 ** OTP_DIGITS).toString().padStart(OTP_DIGITS, "0");
}

function sign(payload: string, code: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`${payload}.${code}`).digest();
}

/**
 * Crée le défi et sa valeur de cookie pour un code donné.
 *
 * @example const { cookie } = sealChallenge("24177123456", "042917", secret)
 */
export function sealChallenge(
  phone: string,
  code: string,
  secret: string,
  now: number = Date.now(),
  signupName?: string
): { challenge: OtpChallenge; cookie: string } {
  const challenge: OtpChallenge = {
    phone,
    exp: now + OTP_TTL_MS,
    nonce: randomBytes(12).toString("base64url"),
    ...(signupName ? { signupName } : {}),
  };
  const payload = Buffer.from(JSON.stringify(challenge)).toString("base64url");
  return { challenge, cookie: `${payload}.${sign(payload, code, secret).toString("base64url")}` };
}

/** Lit le défi d'un cookie, sans rien vérifier. Null si le cookie est illisible. */
export function readChallenge(cookie: string | null | undefined): OtpChallenge | null {
  const payload = (cookie || "").split(".")[0];
  if (!payload) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OtpChallenge>;
    if (typeof data.phone !== "string" || typeof data.exp !== "number" || typeof data.nonce !== "string") return null;
    const signupName = typeof data.signupName === "string" && data.signupName.trim() ? data.signupName.trim().slice(0, 80) : undefined;
    return { phone: data.phone, exp: data.exp, nonce: data.nonce, ...(signupName ? { signupName } : {}) };
  } catch {
    return null;
  }
}

export type OtpCheck = { ok: true; challenge: OtpChallenge } | { ok: false; reason: "invalid" | "expired" };

/**
 * Vérifie le code saisi contre le cookie : signature (comparaison à temps constant) puis expiration.
 *
 * @example const check = checkCode(cookieValue, "042917", secret); if (check.ok) ouvrirSession(check.challenge.phone)
 */
export function checkCode(cookie: string | null | undefined, code: string, secret: string, now: number = Date.now()): OtpCheck {
  const [payload, signature] = (cookie || "").split(".");
  const challenge = readChallenge(cookie);
  if (!payload || !signature || !challenge || !/^\d{6}$/.test(code)) return { ok: false, reason: "invalid" };

  const expected = sign(payload, code, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "invalid" };
  if (challenge.exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, challenge };
}

/** Message WhatsApp qui porte le code. */
export function formatLoginCodeMessage(code: string): string {
  return ["*Mi Casa Alerte*", "", `Votre code de connexion : *${code}*`, "Il est valable 5 minutes. Ne le partagez avec personne."].join("\n");
}
