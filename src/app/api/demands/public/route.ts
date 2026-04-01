import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const {
    userId, client_name, client_phone,
    filter_type_offre, filter_type_bien,
    filter_prix_min, filter_prix_max,
    filter_nb_chambres_min, filter_quartiers,
    filter_ville, exigences,
  } = body;

  if (!userId || !client_name || !client_phone) {
    return NextResponse.json({ error: "Nom et numéro WhatsApp requis" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Verify admin user exists
  const { data: admin } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (!admin) {
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 });
  }

  // Upsert client demand
  const { data, error } = await supabase
    .from("client_demands")
    .upsert({
      user_id: userId,
      client_phone: client_phone,
      client_name,
      is_active: true,
      filter_type_offre: filter_type_offre || [],
      filter_type_bien: filter_type_bien || [],
      filter_prix_min: filter_prix_min || null,
      filter_prix_max: filter_prix_max || null,
      filter_nb_chambres_min: filter_nb_chambres_min || null,
      filter_quartiers: filter_quartiers || [],
      filter_ville: filter_ville || "Libreville",
      exigences: exigences || null,
      source: "form",
      last_message_at: new Date().toISOString(),
    }, { onConflict: "user_id,client_phone" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also create/update chatbot conversation as active
  await supabase.from("chatbot_conversations").upsert({
    user_id: userId,
    client_phone,
    conversation_state: "active",
    context: {},
    last_interaction_at: new Date().toISOString(),
  }, { onConflict: "user_id,client_phone" });

  return NextResponse.json({ success: true, id: data.id });
}
