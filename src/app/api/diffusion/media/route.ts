import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { MAX_MEDIA_ITEMS, MEDIA_CAPTION_MAX, mediaKindFromUrl, type MediaItem } from "@/lib/diffusion";
import { diffusionInstalled, readMedia, saveMedia } from "@/lib/diffusion-runner";
import { PHOTO_BUCKET } from "@/lib/photos";

// Médiathèque de la diffusion, partagée par toutes les campagnes (60 éléments au plus).
// POST multipart : téléverse une photo (≤ 10 Mo) ou une vidéo mp4 (≤ 50 Mo) dans le stockage public,
// puis l'ajoute. POST JSON { url } : ajoute un lien déjà public.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;
const TYPES: Record<string, { ext: string; kind: "image" | "video" }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
};

async function guard() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const service = createServiceClient();
  if (!(await diffusionInstalled(service))) return NextResponse.json({ error: "Tables de la diffusion absentes : exécutez le script SQL." }, { status: 409 });
  return service;
}

export async function GET() {
  const service = await guard();
  if (service instanceof NextResponse) return service;
  return NextResponse.json({ media: await readMedia(service) });
}

export async function POST(request: Request) {
  const service = await guard();
  if (service instanceof NextResponse) return service;
  const items = await readMedia(service);
  if (items.length >= MAX_MEDIA_ITEMS) return NextResponse.json({ error: `La médiathèque est pleine (${MAX_MEDIA_ITEMS} éléments) : retirez-en avant d'en ajouter.` }, { status: 409 });

  let url: string;
  let kind: "image" | "video";
  let title = "";
  let caption = "";
  const type = request.headers.get("content-type") || "";
  if (type.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    const meta = TYPES[file.type];
    if (!meta) return NextResponse.json({ error: "Format refusé : photo JPG, PNG ou WebP, ou vidéo MP4." }, { status: 400 });
    if (file.size > (meta.kind === "video" ? MAX_VIDEO : MAX_IMAGE)) {
      return NextResponse.json({ error: meta.kind === "video" ? "Vidéo trop lourde (50 Mo au plus)." : "Photo trop lourde (10 Mo au plus)." }, { status: 400 });
    }
    const path = `diffusion/${randomUUID()}.${meta.ext}`;
    const { error } = await service.storage.from(PHOTO_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (error) return NextResponse.json({ error: `Téléversement impossible : ${error.message}` }, { status: 500 });
    url = service.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
    kind = meta.kind;
    title = String(form.get("title") || "");
    caption = String(form.get("caption") || "");
  } else {
    const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
    if (typeof body.url !== "string" || !/^https?:\/\//.test(body.url)) return NextResponse.json({ error: "Lien invalide (http ou https)." }, { status: 400 });
    url = body.url;
    kind = body.kind === "video" || body.kind === "image" ? body.kind : mediaKindFromUrl(url);
    title = typeof body.title === "string" ? body.title : "";
    caption = typeof body.caption === "string" ? body.caption : "";
  }

  const item: MediaItem = {
    id: randomUUID(),
    url,
    kind,
    title: title.slice(0, 80),
    caption: caption.slice(0, MEDIA_CAPTION_MAX),
    active: true,
    created_at: new Date().toISOString(),
  };
  const error = await saveMedia(service, [...items, item]);
  if (error) return NextResponse.json({ error: `Enregistrement impossible : ${error}` }, { status: 500 });
  return NextResponse.json({ item });
}

export async function PATCH(request: Request) {
  const service = await guard();
  if (service instanceof NextResponse) return service;
  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  const items = await readMedia(service);
  const index = items.findIndex((m) => m.id === body.id);
  if (index < 0) return NextResponse.json({ error: "Élément introuvable." }, { status: 404 });
  const item = { ...items[index] };
  if (typeof body.title === "string") item.title = body.title.slice(0, 80);
  if (typeof body.caption === "string") item.caption = body.caption.slice(0, MEDIA_CAPTION_MAX);
  if (typeof body.active === "boolean") item.active = body.active;
  items[index] = item;
  const error = await saveMedia(service, items);
  if (error) return NextResponse.json({ error: `Enregistrement impossible : ${error}` }, { status: 500 });
  return NextResponse.json({ item });
}

export async function DELETE(request: Request) {
  const service = await guard();
  if (service instanceof NextResponse) return service;
  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  const items = await readMedia(service);
  const error = await saveMedia(service, items.filter((m) => m.id !== body.id));
  if (error) return NextResponse.json({ error: `Enregistrement impossible : ${error}` }, { status: 500 });
  return NextResponse.json({ success: true });
}
