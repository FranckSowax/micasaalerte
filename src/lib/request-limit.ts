/**
 * Limiteur de débit en mémoire pour les routes publiques (fenêtre glissante).
 *
 * WHY: en mémoire plutôt que Redis — l'app tourne sur une seule instance Railway
 * persistante, donc le compteur survit entre les requêtes. Limites à connaître :
 * il est remis à zéro à chaque redéploiement et n'est pas partagé entre réplicas.
 * Si le service passe à plusieurs réplicas, le remplacer par un compteur partagé.
 */

const MAX_KEYS = 10_000;
const hits = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  /** Secondes à attendre avant la prochaine tentative (0 si autorisé). */
  retryAfterSeconds: number;
}

/**
 * Enregistre une tentative pour `key` et dit si elle est autorisée.
 *
 * @example
 * const { allowed } = checkRateLimit(`form:${ip}`, 5, 10 * 60_000);
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= limit) {
    hits.set(key, recent);
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  recent.push(now);
  hits.set(key, recent);

  // Garde-fou mémoire : un flot de clés distinctes ne doit pas faire grossir la table sans fin.
  if (hits.size > MAX_KEYS) {
    const oldestKey = hits.keys().next().value;
    if (oldestKey !== undefined) hits.delete(oldestKey);
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Adresse IP du client derrière le proxy Railway.
 * On prend `x-real-ip`, sinon la DERNIÈRE entrée de `x-forwarded-for` : c'est celle
 * ajoutée par le proxy ; les premières sont fournies par le client et falsifiables.
 */
export function getClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  return "unknown";
}
