import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { data, error } = await supabase
    .from("contributors")
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
  const { member_url, member_name } = body;

  // Parse: facebook.com/groups/XXX/user/YYY
  const match = member_url?.match(/facebook\.com\/groups\/([^/]+)\/user\/([^/?]+)/);
  if (!match) {
    return NextResponse.json(
      { error: "URL invalide. Format attendu : https://facebook.com/groups/GROUP_ID/user/USER_ID/" },
      { status: 400 }
    );
  }

  const groupId = match[1];
  const memberId = match[2];

  // Try to get group name from facebook_groups table
  const { data: fbGroup } = await supabase
    .from("facebook_groups")
    .select("group_name")
    .eq("group_id", groupId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("contributors")
    .insert({
      user_id: user.id,
      group_id: groupId,
      group_name: (fbGroup as Record<string, unknown>)?.group_name as string || `Groupe ${groupId}`,
      member_id: memberId,
      member_name: member_name || `Membre ${memberId}`,
      member_url,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes("duplicate")) {
      return NextResponse.json({ error: "Ce contributeur est déjà ajouté" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
