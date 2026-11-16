import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { data, error } = await supabase
    .from("client_demands")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  // SECURITY: les champs d'accès et d'abonnement ne se fixent pas à la création (lien, appareil, dates payées).
  const { id: _id, user_id: _u, access_token: _t, device_hash: _d, paid_until: _p, trial_ends_at: _tr, expiry_notified_at: _e, created_at: _c, ...fields } =
    body as Record<string, unknown>;

  const { data, error } = await supabase
    .from("client_demands")
    .insert({ ...fields, user_id: user.id, source: "admin" })
    .select()
    .single();

  if (error) {
    if (error.message.includes("duplicate")) {
      return NextResponse.json({ error: "Ce numéro est déjà enregistré" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
