import { createServiceClient } from "@/lib/supabase/server";
import { formatAnnonceMessage, sendWhatsAppMessage, annonceMatchesFilter } from "@/lib/whatsapp";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Get all unsent annonces across all users
  const { data: annonces } = await serviceClient
    .from("annonces")
    .select("*")
    .eq("ai_is_real_estate", true)
    .eq("is_sent_whatsapp", false)
    .eq("status", "new")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!annonces?.length) {
    return NextResponse.json({ message: "No new annonces to send" });
  }

  // Group by user_id
  const byUser = new Map<string, typeof annonces>();
  for (const a of annonces) {
    const list = byUser.get(a.user_id) || [];
    list.push(a);
    byUser.set(a.user_id, list);
  }

  let totalSent = 0;

  for (const [userId, userAnnonces] of Array.from(byUser.entries())) {
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("whatsapp_phone_number_id, whatsapp_access_token")
      .eq("id", userId)
      .single();

    const phoneNumberId = profile?.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = profile?.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken) continue;

    const { data: channels } = await serviceClient
      .from("whatsapp_channels")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (!channels?.length) continue;

    for (const annonce of userAnnonces) {
      const message = formatAnnonceMessage(annonce);
      let sent = false;

      for (const channel of channels) {
        if (!annonceMatchesFilter(annonce, channel)) continue;

        const result = await sendWhatsAppMessage(phoneNumberId, accessToken, channel.phone_number, message);

        await serviceClient.from("whatsapp_logs").insert({
          user_id: userId,
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
        await serviceClient
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
  }

  return NextResponse.json({ success: true, totalSent });
}
