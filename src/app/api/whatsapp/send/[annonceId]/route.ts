import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  formatAnnonceMessage,
  sendWhatsAppMessage,
  isWahaConfigured,
  annonceMatchesFilter,
} from "@/lib/whatsapp";
import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  { params }: { params: { annonceId: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const serviceClient = createServiceClient();

  // Get annonce
  const { data: annonce } = await supabase
    .from("annonces")
    .select("*")
    .eq("id", params.annonceId)
    .eq("user_id", user.id)
    .single();

  if (!annonce) {
    return NextResponse.json({ error: "Annonce non trouvée" }, { status: 404 });
  }

  if (!isWahaConfigured()) {
    return NextResponse.json({ error: "WhatsApp (WAHA) non configuré" }, { status: 400 });
  }

  // Get active channels
  const { data: channels } = await supabase
    .from("whatsapp_channels")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (!channels?.length) {
    return NextResponse.json({ error: "Aucun canal WhatsApp actif" }, { status: 400 });
  }

  const message = formatAnnonceMessage(annonce);
  const results = [];

  for (const channel of channels) {
    if (!annonceMatchesFilter(annonce, channel)) continue;

    const result = await sendWhatsAppMessage(channel.phone_number, message, {
        group: channel.channel_type === "group",
      });

    // Log
    await serviceClient.from("whatsapp_logs").insert({
      user_id: user.id,
      annonce_id: annonce.id,
      channel_id: channel.id,
      phone_number: channel.phone_number,
      message_id: result.messageId || null,
      status: result.success ? "sent" : "failed",
      error_message: result.error || null,
    });

    results.push({
      channel: channel.name,
      success: result.success,
      error: result.error,
    });
  }

  // Update annonce status
  if (results.some((r) => r.success)) {
    await supabase
      .from("annonces")
      .update({
        is_sent_whatsapp: true,
        sent_whatsapp_at: new Date().toISOString(),
        status: "sent",
      })
      .eq("id", annonce.id);
  }

  return NextResponse.json({ success: true, results });
}
