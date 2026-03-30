import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { data, error } = await supabase
    .from("agent_profiles")
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
  const { profile_url, profile_name } = body;

  // Extract profile_id from URL
  const match = profile_url?.match(/facebook\.com\/(?:profile\.php\?id=(\d+)|([^/?]+))/);
  if (!match) {
    return NextResponse.json({ error: "URL de profil Facebook invalide" }, { status: 400 });
  }
  const profileId = match[1] || match[2];

  const { data, error } = await supabase
    .from("agent_profiles")
    .insert({
      user_id: user.id,
      profile_id: profileId,
      profile_url,
      profile_name: profile_name || profileId,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes("duplicate")) {
      return NextResponse.json({ error: "Ce profil est déjà ajouté" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
