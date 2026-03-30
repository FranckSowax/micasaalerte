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

  if (!groupId) return NextResponse.json({ error: "groupId requis" }, { status: 400 });

  // Fetch one page from RapidAPI
  const url = new URL("https://facebook-scraper3.p.rapidapi.com/group/posts");
  url.searchParams.set("group_id", groupId);
  url.searchParams.set("sorting_order", "CHRONOLOGICAL");

  const response = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": rapidapiKey,
      "x-rapidapi-host": "facebook-scraper3.p.rapidapi.com",
    },
  });

  const data = await response.json();

  // Return raw structure with all keys for first 3 posts
  const posts = data.posts || data.results || [];
  const debug = posts.slice(0, 3).map((post: Record<string, unknown>) => ({
    _allKeys: Object.keys(post),
    post_id: post.post_id || post.id,
    message: typeof post.message === "string" ? (post.message as string).substring(0, 100) : null,
    // All possible image fields
    photo_url: post.photo_url,
    image: post.image,
    full_picture: post.full_picture,
    picture: post.picture,
    images: post.images,
    photos: post.photos,
    attachments: post.attachments,
    media: post.media,
    attached_media: post.attached_media,
    // Nested
    attached_post: post.attached_post ? Object.keys(post.attached_post as Record<string, unknown>) : null,
  }));

  return NextResponse.json({
    _topLevelKeys: Object.keys(data),
    totalPosts: posts.length,
    posts: debug,
  });
}
