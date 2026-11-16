// Accès à l'administration : réservé aux agents autorisés.
// SECURITY: la création de compte Supabase est ouverte (email confirmé suffit). Sans ce contrôle,
// n'importe qui obtiendrait un espace agent et pourrait faire envoyer des messages par le numéro
// WhatsApp de la plateforme ou consommer le crédit IA. La liste vient de AGENT_EMAILS (emails
// séparés par des virgules) et AGENT_USER_IDS ; si les deux sont vides, seul le compte principal
// (OWNER_USER_ID, ou le plus ancien compte agent) est autorisé.
// Module sans dépendance Node : utilisable dans le middleware (runtime Edge).

export interface ProfileLite {
  id: string;
  email: string | null;
}

/** Comptes techniques de l'ancienne inscription WhatsApp (wa-<numéro>@…) : jamais des agents. */
const TECHNICAL_EMAIL = /^wa-\d+@/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function list(value: string | undefined): string[] {
  return (value || "")
    .split(/[,;\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Identifiants des agents autorisés, à partir des profils triés du plus ancien au plus récent.
 *
 * @example allowedAgentIds(profils, { AGENT_EMAILS: "moi@exemple.com" })
 */
export function allowedAgentIds(profilesOldestFirst: ProfileLite[], env: Record<string, string | undefined> = process.env): Set<string> {
  const emails = new Set(list(env.AGENT_EMAILS));
  const ids = new Set(list(env.AGENT_USER_IDS).filter((id) => UUID.test(id)));
  const allowed = new Set<string>();

  if (emails.size || ids.size) {
    for (const p of profilesOldestFirst) {
      const email = (p.email || "").toLowerCase();
      if (ids.has(p.id.toLowerCase()) || (email && emails.has(email) && !TECHNICAL_EMAIL.test(email))) allowed.add(p.id);
    }
    return allowed;
  }

  const owner = (env.OWNER_USER_ID || "").trim();
  if (UUID.test(owner)) return new Set([owner]);
  const oldest = profilesOldestFirst.find((p) => !TECHNICAL_EMAIL.test(p.email || ""));
  return oldest ? new Set([oldest.id]) : allowed;
}

/** Routes API ouvertes sans compte agent (elles ont leur propre contrôle d'accès). */
const PUBLIC_API = ["/api/auth/", "/api/client/", "/api/demands/public", "/api/webhook/", "/api/cron/", "/api/health", "/api/quartiers"];

/** La route API est-elle réservée aux agents ? */
export function isAgentApi(pathname: string): boolean {
  return pathname.startsWith("/api/") && !PUBLIC_API.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

const CACHE_MS = 5 * 60_000;
let cache: { ids: Set<string>; at: number } | null = null;

/**
 * Agents autorisés, lus dans la base avec la clé service (mis en cache 5 minutes).
 * Utilisable dans le middleware comme dans les routes. Null si la base ne répond pas.
 */
export async function fetchAllowedAgentIds(now: number = Date.now()): Promise<Set<string> | null> {
  if (cache && now - cache.at < CACHE_MS) return cache.ids;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/profiles?select=id,email&order=created_at.asc&limit=500`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return cache?.ids ?? null;
    const ids = allowedAgentIds((await res.json()) as ProfileLite[]);
    cache = { ids, at: now };
    return ids;
  } catch {
    return cache?.ids ?? null;
  }
}
