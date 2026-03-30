import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { data, error } = await supabase
    .from("facebook_groups")
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

  const body = await request.json();
  const { group_url, group_name } = body;

  // Extract group_id from URL
  const match = group_url?.match(/facebook\.com\/groups\/([^/?]+)/);
  if (!match) {
    return NextResponse.json({ error: "URL de groupe invalide" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("facebook_groups")
    .insert({
      user_id: user.id,
      group_id: match[1],
      group_url,
      group_name: group_name || `Groupe ${match[1]}`,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes("duplicate")) {
      return NextResponse.json({ error: "Ce groupe est déjà ajouté" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
