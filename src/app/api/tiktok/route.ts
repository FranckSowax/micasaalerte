import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { data, error } = await supabase
    .from("tiktok_accounts")
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
  const { tiktok_url, tiktok_handle: providedHandle } = body;

  // Extract handle from URL: tiktok.com/@handle or just handle
  let handle = providedHandle;
  if (tiktok_url) {
    const match = tiktok_url.match(/tiktok\.com\/@([^/?]+)/);
    if (match) handle = match[1];
  }

  if (!handle) {
    return NextResponse.json({ error: "URL TikTok invalide. Format : https://tiktok.com/@nom_utilisateur" }, { status: 400 });
  }

  // Remove @ if present
  handle = handle.replace(/^@/, "");

  const { data, error } = await supabase
    .from("tiktok_accounts")
    .insert({
      user_id: user.id,
      tiktok_handle: handle,
      tiktok_url: tiktok_url || `https://tiktok.com/@${handle}`,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes("duplicate")) {
      return NextResponse.json({ error: "Ce compte TikTok est déjà ajouté" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
