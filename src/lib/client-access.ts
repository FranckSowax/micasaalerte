import { createHash, randomBytes } from "crypto";

// Accès à l'espace client par lien personnel.
// Le lien contient un jeton aléatoire impossible à deviner. Il est en plus lié au premier
// appareil qui l'ouvre : transféré à quelqu'un d'autre, il est refusé. Le titulaire du
// numéro WhatsApp peut toujours demander un nouveau lien, envoyé sur son propre numéro.

export const DEVICE_COOKIE = "mca_device";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;

/** Jeton d'accès aléatoire (192 bits), utilisable dans une adresse. */
export function generateAccessToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Identifiant aléatoire d'appareil, déposé dans un cookie. */
export function generateDeviceId(): string {
  return randomBytes(18).toString("base64url");
}

export function isValidToken(token: string | null | undefined): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/** Seule l'empreinte de l'identifiant d'appareil est enregistrée en base, jamais l'identifiant. */
export function hashDevice(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}

export type DeviceCheck = "bind" | "ok" | "other_device";

/**
 * Décide si l'appareil qui présente le lien peut l'utiliser.
 * - aucun appareil encore lié → on lie celui-ci ;
 * - même appareil → accès ;
 * - autre appareil → refus (lien transféré, ou cookies effacés).
 *
 * @example checkDevice(demand.device_hash, cookieValue) === "other_device"
 */
export function checkDevice(storedHash: string | null | undefined, deviceId: string | null | undefined): DeviceCheck {
  if (!storedHash) return "bind";
  if (deviceId && hashDevice(deviceId) === storedHash) return "ok";
  return "other_device";
}

/** Adresse de l'espace client pour un jeton. */
export function clientLink(token: string, baseUrl = process.env.NEXT_PUBLIC_APP_URL || ""): string {
  return `${baseUrl.replace(/\/+$/, "")}/c/${token}`;
}
