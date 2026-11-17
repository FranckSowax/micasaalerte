import { NextResponse } from "next/server";
import { clientLink } from "@/lib/client-access";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { clientLinkImage, formatClientLinkMessage, isWahaConfigured, sendWhatsAppMessage } from "@/lib/whatsapp";

// Envoi test (Paramètres) : le message « lien de l'espace », avec la photo réglée, part vers le
// numéro WhatsApp du profil de l'agent connecté. Jamais vers un abonné.

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!isWahaConfigured()) return NextResponse.json({ error: "WhatsApp (WAHA) n'est pas configuré." }, { status: 503 });

  const { data: profile } = await createServiceClient().from("profiles").select("full_name, whatsapp_phone").eq("id", data.user.id).maybeSingle();
  const phone = (profile?.whatsapp_phone as string | null | undefined)?.replace(/\D/g, "");
  if (!phone || phone.length < 8) {
    return NextResponse.json({ error: "Renseignez d'abord votre « Téléphone WhatsApp » dans Profil, puis Sauvegarder." }, { status: 400 });
  }

  const image = await clientLinkImage();
  const text = [
    "_Message de test : voici ce que reçoivent vos abonnés._",
    "",
    formatClientLinkMessage({ name: (profile?.full_name as string | null) || null, count: 1, link: clientLink("exemple") }),
  ].join("\n");
  const sent = await sendWhatsAppMessage(phone, text, { image });
  if (!sent.success) return NextResponse.json({ error: `L'envoi a échoué : ${sent.error || "erreur inconnue"}` }, { status: 502 });
  return NextResponse.json({ success: true, withImage: !!image && !sent.imageError, imageError: sent.imageError ?? null });
}
