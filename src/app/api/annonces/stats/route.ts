import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { data } = await supabase
    .from("v_dashboard_stats")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json(data || {
    total_annonces: 0,
    nouvelles_24h: 0,
    favoris: 0,
    envoyees_whatsapp: 0,
    prix_moyen_location: null,
    prix_moyen_vente: null,
  });
}
