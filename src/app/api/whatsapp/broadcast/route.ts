import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  formatAnnonceMessage,
  sendWhatsAppMessage,
  isWahaConfigured,
  annonceMatchesFilter,
} from "@/lib/whatsapp";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const serviceClient = createServiceClient();

  if (!isWahaConfigured()) {
    return NextResponse.json({ error: "WhatsApp (WAHA) non configuré" }, { status: 400 });
  }

  // Get unsent annonces
  const { data: annonces } = await supabase
    .from("annonces")
    .select("*")
    .eq("user_id", user.id)
    .eq("ai_is_real_estate", true)
    .eq("is_sent_whatsapp", false)
    .eq("status", "new")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!annonces?.length) {
    return NextResponse.json({ message: "Aucune nouvelle annonce à envoyer" });
  }

  const { data: channels } = await supabase
    .from("whatsapp_channels")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (!channels?.length) {
    return NextResponse.json({ error: "Aucun canal WhatsApp actif" }, { status: 400 });
  }

  let totalSent = 0;

  for (const annonce of annonces) {
    const message = formatAnnonceMessage(annonce);
    let sent = false;

    for (const channel of channels) {
      if (!annonceMatchesFilter(annonce, channel)) continue;

      const result = await sendWhatsAppMessage(channel.phone_number, message, {
        group: channel.channel_type === "group",
        log: false, // enregistré plus bas avec le canal
      });

      await serviceClient.from("whatsapp_logs").insert({
        user_id: user.id,
        annonce_id: annonce.id,
        channel_id: channel.id,
        phone_number: channel.phone_number,
        message_id: result.messageId || null,
        status: result.success ? "sent" : "failed",
        error_message: result.error || null,
      });

      if (result.success) sent = true;
    }

    if (sent) {
      await supabase
        .from("annonces")
        .update({
          is_sent_whatsapp: true,
          sent_whatsapp_at: new Date().toISOString(),
          status: "sent",
        })
        .eq("id", annonce.id);
      totalSent++;
    }
  }

  return NextResponse.json({
    success: true,
    totalAnnonces: annonces.length,
    totalSent,
  });
}
