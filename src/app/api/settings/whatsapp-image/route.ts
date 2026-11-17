import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { PHOTO_BUCKET } from "@/lib/photos";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { CLIENT_LINK_IMAGE_KEY } from "@/lib/whatsapp";

// Photo jointe aux messages WhatsApp qui envoient le lien de l'espace client (Paramètres).
// GET : photo actuelle. POST multipart (champ « file ») : remplace la photo. DELETE : la retire,
// les messages repartent alors en texte seul. Réservé aux agents (middleware + session ici).

export const dynamic = "force-dynamic";

// WHY: WhatsApp recompresse les photos ; au-delà de 5 Mo l'envoi ralentit sans gain visible.
const MAX_BYTES = 5 * 1024 * 1024;
// JPG et PNG seulement : une image WebP peut arriver comme autocollant sur certains téléphones.
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

async function guard() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  return createServiceClient();
}

type Service = ReturnType<typeof createServiceClient>;

async function currentUrl(service: Service): Promise<string | null> {
  const { data } = await service.from("wa_settings").select("value").eq("key", CLIENT_LINK_IMAGE_KEY).maybeSingle();
  const url = (data?.value as { url?: unknown } | null)?.url;
  return typeof url === "string" ? url : null;
}

/** Retire l'ancien fichier du stockage s'il vient de ce réglage (sans bloquer en cas d'échec). */
async function removeStored(service: Service, url: string | null) {
  const path = url?.split(`/storage/v1/object/public/${PHOTO_BUCKET}/`)[1];
  if (path?.startsWith("whatsapp/")) await service.storage.from(PHOTO_BUCKET).remove([decodeURIComponent(path)]);
}

export async function GET() {
  const service = await guard();
  if (service instanceof NextResponse) return service;
  return NextResponse.json({ url: await currentUrl(service) });
}

export async function POST(request: Request) {
  const service = await guard();
  if (service instanceof NextResponse) return service;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Format refusé : photo JPG ou PNG." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Photo trop lourde (5 Mo au plus)." }, { status: 400 });

  const path = `whatsapp/message-${randomUUID()}.${ext}`;
  const { error } = await service.storage.from(PHOTO_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return NextResponse.json({ error: `Téléversement impossible : ${error.message}` }, { status: 500 });
  const url = service.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

  const previous = await currentUrl(service);
  const { error: saveError } = await service.from("wa_settings").upsert({ key: CLIENT_LINK_IMAGE_KEY, value: { url }, updated_at: new Date().toISOString() });
  if (saveError) {
    await service.storage.from(PHOTO_BUCKET).remove([path]);
    return NextResponse.json({ error: "Enregistrement impossible : la table wa_settings manque-t-elle ? Exécutez le script SQL." }, { status: 500 });
  }
  await removeStored(service, previous);
  return NextResponse.json({ url });
}

export async function DELETE() {
  const service = await guard();
  if (service instanceof NextResponse) return service;
  const previous = await currentUrl(service);
  const { error } = await service.from("wa_settings").delete().eq("key", CLIENT_LINK_IMAGE_KEY);
  if (error) return NextResponse.json({ error: "Suppression impossible." }, { status: 500 });
  await removeStored(service, previous);
  return NextResponse.json({ url: null });
}
