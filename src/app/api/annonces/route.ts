import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(request.url);

  let query = supabase
    .from("annonces")
    .select("*")
    .eq("user_id", user.id)
    .eq("ai_is_real_estate", true)
    .order("created_at", { ascending: false });

  const typeOffre = searchParams.get("type_offre");
  const typeBien = searchParams.get("type_bien");
  const status = searchParams.get("status");
  const prixMin = searchParams.get("prix_min");
  const prixMax = searchParams.get("prix_max");
  const quartier = searchParams.get("quartier");
  const ville = searchParams.get("ville");
  const limit = searchParams.get("limit");

  if (typeOffre) query = query.eq("type_offre", typeOffre);
  if (typeBien) query = query.eq("type_bien", typeBien);
  if (status) query = query.eq("status", status);
  if (prixMin) query = query.gte("prix", Number(prixMin));
  if (prixMax) query = query.lte("prix", Number(prixMax));
  if (quartier) query = query.ilike("quartier", `%${quartier}%`);
  if (ville) query = query.ilike("ville", `%${ville}%`);

  query = query.limit(Number(limit) || 50);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
