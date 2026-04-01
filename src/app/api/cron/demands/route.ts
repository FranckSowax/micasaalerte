import { createServiceClient } from "@/lib/supabase/server";
import { formatAnnonceMessage, sendWhatsAppMessage } from "@/lib/whatsapp";
import { sleep } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import type { Annonce, ClientDemand } from "@/types/database";

function demandMatchesAnnonce(annonce: Annonce, demand: ClientDemand): boolean {
  if (demand.filter_type_offre?.length && annonce.type_offre) {
    if (!demand.filter_type_offre.includes(annonce.type_offre)) return false;
  }
  if (demand.filter_type_bien?.length && annonce.type_bien) {
    if (!demand.filter_type_bien.includes(annonce.type_bien)) return false;
  }
  if (demand.filter_prix_min && annonce.prix) {
    if (annonce.prix < demand.filter_prix_min) return false;
  }
  if (demand.filter_prix_max && annonce.prix) {
    if (annonce.prix > demand.filter_prix_max) return false;
  }
  if (demand.filter_nb_chambres_min && annonce.nb_chambres) {
    if (annonce.nb_chambres < demand.filter_nb_chambres_min) return false;
  }
  if (demand.filter_quartiers?.length && annonce.quartier) {
    if (!demand.filter_quartiers.some(q =>
      annonce.quartier?.toLowerCase().includes(q.toLowerCase())
    )) return false;
  }
  if (demand.filter_ville && annonce.ville) {
    if (annonce.ville.toLowerCase() !== demand.filter_ville.toLowerCase()) return false;
  }
  if (demand.filter_meuble !== null && demand.filter_meuble !== undefined && annonce.meuble !== null) {
    if (annonce.meuble !== demand.filter_meuble) return false;
  }
  return true;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get all active demands grouped by user
  const { data: demands } = await supabase
    .from("client_demands")
    .select("*")
    .eq("is_active", true);

  if (!demands?.length) {
    return NextResponse.json({ message: "No active demands" });
  }

  // Group by user_id
  const byUser = new Map<string, typeof demands>();
  for (const d of demands) {
    const list = byUser.get(d.user_id as string) || [];
    list.push(d);
    byUser.set(d.user_id as string, list);
  }

  let totalSent = 0;

  for (const [userId, userDemands] of Array.from(byUser.entries())) {
    // Get admin's WhatsApp credentials
    const { data: profile } = await supabase
      .from("profiles")
      .select("whatsapp_phone_number_id, whatsapp_access_token")
      .eq("id", userId)
      .single();

    const phoneNumberId = (profile as Record<string, unknown>)?.whatsapp_phone_number_id as string || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = (profile as Record<string, unknown>)?.whatsapp_access_token as string || process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken) continue;

    // Get recent annonces
    const { data: annonces } = await supabase
      .from("annonces")
      .select("*")
      .eq("user_id", userId)
      .eq("ai_is_real_estate", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!annonces?.length) continue;

    for (const demand of userDemands) {
      const typedDemand = demand as unknown as ClientDemand;

      // Get already sent annonce IDs for this demand
      const { data: alreadySent } = await supabase
        .from("client_demand_sends")
        .select("annonce_id")
        .eq("demand_id", typedDemand.id);

      const sentIds = new Set((alreadySent || []).map((s: Record<string, unknown>) => s.annonce_id));

      for (const annonce of annonces) {
        const typedAnnonce = annonce as unknown as Annonce;

        if (sentIds.has(typedAnnonce.id)) continue;
        if (!demandMatchesAnnonce(typedAnnonce, typedDemand)) continue;

        // Send
        const message = formatAnnonceMessage(typedAnnonce);
        const result = await sendWhatsAppMessage(
          phoneNumberId,
          accessToken,
          typedDemand.client_phone,
          message
        );

        // Track send
        await supabase.from("client_demand_sends").insert({
          demand_id: typedDemand.id,
          annonce_id: typedAnnonce.id,
          message_id: result.messageId || null,
          status: result.success ? "sent" : "failed",
        });

        if (result.success) totalSent++;

        await sleep(500); // Avoid WhatsApp rate limits
      }
    }
  }

  return NextResponse.json({ success: true, totalSent });
}
