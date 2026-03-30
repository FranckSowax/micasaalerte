import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const serviceClient = createServiceClient();
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("rapidapi_key")
    .eq("id", user.id)
    .single();

  const rapidapiKey = profile?.rapidapi_key || process.env.RAPIDAPI_KEY;
  if (!rapidapiKey) return NextResponse.json({ error: "Clé RapidAPI non configurée" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const groupId = body.groupId as string;
  const profileId = body.profileId as string;

  if (!groupId && !profileId) return NextResponse.json({ error: "groupId ou profileId requis" }, { status: 400 });

  const endpoint = profileId ? "profile/posts" : "group/posts";
  const paramName = profileId ? "profile_id" : "group_id";
  const paramValue = profileId || groupId;

  const url = new URL(`https://facebook-scraper3.p.rapidapi.com/${endpoint}`);
  url.searchParams.set(paramName, paramValue);
  if (!profileId) url.searchParams.set("sorting_order", "CHRONOLOGICAL");

  const response = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": rapidapiKey,
      "x-rapidapi-host": "facebook-scraper3.p.rapidapi.com",
    },
  });

  const data = await response.json();
  const posts = data.posts || data.results || [];

  // Return FULL raw data for first 3 posts (no filtering)
  const debug = posts.slice(0, 3).map((post: Record<string, unknown>) => ({
    _allKeys: Object.keys(post),
    _raw: post, // Full raw post data
  }));

  return NextResponse.json({
    _topLevelKeys: Object.keys(data),
    totalPosts: posts.length,
    posts: debug,
  });
}
