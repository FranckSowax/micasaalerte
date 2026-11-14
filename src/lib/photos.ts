import { createHash } from "crypto";
import type { createServiceClient } from "@/lib/supabase/server";

// Photos des annonces. Les liens fournis par Facebook et TikTok sont signés et expirent en
// 2 à 5 jours : sans copie, la photo d'une annonce disparaît. On copie donc chaque photo dans
// le stockage Supabase (bucket public) et l'annonce pointe vers cette copie permanente.

export const PHOTO_BUCKET = "annonces";
const MAX_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_PER_ANNONCE = 2;
const RECENT_ANNONCES = 300;
/** Après ce nombre d'échecs réseau, on cesse de réessayer un lien jusqu'au prochain redémarrage. */
const MAX_ATTEMPTS = 3;

// Seuls les serveurs d'images des réseaux collectés sont téléchargés : le lien vient d'un
// flux externe, on ne va pas chercher n'importe quelle adresse.
const ALLOWED_HOSTS = [/\.fbcdn\.net$/, /\.cdninstagram\.com$/, /\.tiktokcdn(-[a-z0-9]+)?\.com$/];
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

type Client = ReturnType<typeof createServiceClient>;

const attempts = new Map<string, number>();
let bucketReady = false;

function storagePrefix(baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""): string {
  return `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/`;
}

/** La photo est-elle déjà une copie permanente dans notre stockage ? */
export function isStoredPhoto(url: string, baseUrl?: string): boolean {
  return typeof url === "string" && url.startsWith(storagePrefix(baseUrl));
}

/** Le lien pointe-t-il vers un serveur d'images autorisé, en HTTPS ? */
export function isCopyablePhoto(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.some((host) => host.test(parsed.hostname));
  } catch {
    return false;
  }
}

/** Chemin stable dans le bucket : relancer la copie d'un même lien écrase le même fichier. */
export function photoPath(userId: string, annonceId: string, sourceUrl: string, contentType: string): string {
  const ext = EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] || "jpg";
  // Le chemin ignore la signature du lien (paramètres), qui change à chaque lecture du flux.
  const stable = sourceUrl.split("?")[0];
  return `${userId}/${annonceId}/${createHash("sha1").update(stable).digest("hex").slice(0, 16)}.${ext}`;
}

type CopyResult = { status: "stored"; url: string } | { status: "dead" } | { status: "failed" };

async function copyPhoto(client: Client, userId: string, annonceId: string, sourceUrl: string): Promise<CopyResult> {
  let response: Response;
  try {
    response = await fetch(sourceUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  } catch {
    return { status: "failed" };
  }
  // Lien expiré ou supprimé : il ne reviendra pas.
  if ([400, 403, 404, 410].includes(response.status)) return { status: "dead" };
  if (!response.ok) return { status: "failed" };

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) return { status: "dead" };
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return { status: "dead" };

  const path = photoPath(userId, annonceId, sourceUrl, contentType);
  const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) {
    console.error("Photo upload failed:", error.message);
    return { status: "failed" };
  }
  return { status: "stored", url: client.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl };
}

async function ensureBucket(client: Client): Promise<void> {
  if (bucketReady) return;
  // Sans effet si le bucket existe déjà (l'erreur « already exists » est ignorée).
  await client.storage.createBucket(PHOTO_BUCKET, { public: true, fileSizeLimit: MAX_BYTES });
  bucketReady = true;
}

/**
 * Copie dans le stockage les photos des annonces récentes qui pointent encore vers
 * Facebook ou TikTok, les plus récentes d'abord. Un lien mort est retiré de l'annonce.
 *
 * @example const { stored, dead } = await persistPhotos(client, 25)
 */
export async function persistPhotos(client: Client, limit = 25): Promise<{ stored: number; dead: number; failed: number }> {
  const stats = { stored: 0, dead: 0, failed: 0 };
  const { data } = await client
    .from("annonces")
    .select("id, user_id, raw_images")
    .eq("ai_is_real_estate", true)
    .order("created_at", { ascending: false })
    .limit(RECENT_ANNONCES);

  const todo = ((data || []) as { id: string; user_id: string; raw_images: string[] | null }[]).filter((a) =>
    (a.raw_images || []).slice(0, MAX_PER_ANNONCE).some((url) => !isStoredPhoto(url) && (attempts.get(url) || 0) < MAX_ATTEMPTS)
  );
  if (!todo.length) return stats;

  await ensureBucket(client);

  let copies = 0;
  for (const annonce of todo) {
    if (copies >= limit) break;
    const next: string[] = [];
    let changed = false;
    for (const url of (annonce.raw_images || []).slice(0, MAX_PER_ANNONCE)) {
      if (isStoredPhoto(url)) {
        next.push(url);
        continue;
      }
      if (!isCopyablePhoto(url)) {
        // Lien d'une autre origine : laissé tel quel, jamais téléchargé.
        next.push(url);
        attempts.set(url, MAX_ATTEMPTS);
        continue;
      }
      copies++;
      const result = await copyPhoto(client, annonce.user_id, annonce.id, url);
      if (result.status === "stored") {
        next.push(result.url);
        changed = true;
        stats.stored++;
      } else if (result.status === "dead") {
        changed = true;
        stats.dead++;
      } else {
        next.push(url);
        attempts.set(url, (attempts.get(url) || 0) + 1);
        stats.failed++;
      }
    }
    if (changed) await client.from("annonces").update({ raw_images: next }).eq("id", annonce.id);
  }
  return stats;
}
