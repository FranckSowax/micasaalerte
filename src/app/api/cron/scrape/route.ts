import { createServiceClient } from "@/lib/supabase/server";
import { analyzePost } from "@/lib/ai";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Get all active groups with user profiles
  const { data: groups } = await serviceClient
    .from("facebook_groups")
    .select("*, profiles!inner(rapidapi_key, kimi_api_key)")
    .eq("is_active", true);

  if (!groups?.length) {
    return NextResponse.json({ message: "No active groups" });
  }

  const results = [];

  for (const group of groups) {
    const profile = (group as Record<string, unknown>).profiles as {
      rapidapi_key: string | null;
      kimi_api_key: string | null;
    };
    const rapidapiKey = profile?.rapidapi_key || process.env.RAPIDAPI_KEY;
    const kimiKey = profile?.kimi_api_key || process.env.KIMI_API_KEY;

    if (!rapidapiKey) continue;

    let postsNew = 0;

    try {
      const url = new URL("https://facebook-scraper3.p.rapidapi.com/group/posts");
      url.searchParams.set("group_id", group.group_id);
      url.searchParams.set("sorting_order", "CHRONOLOGICAL");

      const response = await fetch(url.toString(), {
        headers: {
          "x-rapidapi-key": rapidapiKey,
          "x-rapidapi-host": "facebook-scraper3.p.rapidapi.com",
        },
      });

      if (!response.ok) continue;

      const data = await response.json();
      const posts = data.posts || data.results || [];

      for (const post of posts) {
        const postId = post.post_id || post.id;
        const text = post.message || post.text || "";
        if (!text || !postId) continue;

        const { data: existing } = await serviceClient
          .from("annonces")
          .select("id")
          .eq("user_id", group.user_id)
          .eq("fb_post_id", String(postId))
          .maybeSingle();

        if (existing) continue;

        try {
          const analysis = await analyzePost(text, kimiKey);
          if (!analysis.is_real_estate) continue;

          await serviceClient.from("annonces").insert({
            user_id: group.user_id,
            fb_post_id: String(postId),
            fb_post_url: post.url || null,
            fb_group_id: group.id,
            fb_author_name: post.author?.name || null,
            fb_author_id: post.author?.id ? String(post.author.id) : null,
            fb_posted_at: post.timestamp ? new Date(post.timestamp * 1000).toISOString() : null,
            raw_text: text,
            raw_images: post.photo_url ? [post.photo_url] : [],
            type_bien: analysis.type_bien,
            type_offre: analysis.type_offre,
            prix: analysis.prix,
            nb_pieces: analysis.nb_pieces,
            nb_chambres: analysis.nb_chambres,
            nb_salles_bain: analysis.nb_salles_bain,
            superficie: analysis.superficie,
            meuble: analysis.meuble,
            quartier: analysis.quartier,
            ville: analysis.ville || "Libreville",
            adresse_complete: analysis.adresse_complete,
            telephone: analysis.telephone,
            whatsapp: analysis.whatsapp,
            email: analysis.email,
            ai_confidence: analysis.confidence,
            ai_summary: analysis.summary,
            ai_is_real_estate: true,
            ai_tags: analysis.tags || [],
          });
          postsNew++;
        } catch {
          // Skip failed analyses
        }
      }

      await serviceClient
        .from("facebook_groups")
        .update({ last_scraped_at: new Date().toISOString() })
        .eq("id", group.id);

      results.push({ group: group.group_name, postsNew });
    } catch (error) {
      results.push({ group: group.group_name, error: error instanceof Error ? error.message : "Unknown" });
    }
  }

  return NextResponse.json({ success: true, results });
}
