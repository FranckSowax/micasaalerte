import { createHash, timingSafeEqual } from "crypto";

/**
 * Compare deux chaînes en temps constant (évite les attaques temporelles).
 * Les valeurs sont hachées d'abord pour ne pas révéler leur longueur.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Vérifie qu'une requête cron porte bien `Authorization: Bearer <CRON_SECRET>`.
 * L'en-tête est envoyé par scripts/run-cron.mjs (service cron Railway).
 * Refuse tout si CRON_SECRET est absent : sans cela, l'en-tête
 * "Bearer undefined" suffirait à passer.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  return safeEqual(authHeader, `Bearer ${secret}`);
}
