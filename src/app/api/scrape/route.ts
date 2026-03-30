import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzePost } from "@/lib/ai";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const specificGroupId = body.groupId as string | undefined;

  // Get user profile for API keys
  const serviceClient = createServiceClient();
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("rapidapi_key, kimi_api_key")
    .eq("id", user.id)
    .single();

  const rapidapiKey = profile?.rapidapi_key || process.env.RAPIDAPI_KEY;
  const kimiKey = profile?.kimi_api_key || process.env.KIMI_API_KEY;

  if (!rapidapiKey) {
    return NextResponse.json({ error: "Clé RapidAPI non configurée" }, { status: 400 });
  }

  // Get active groups
  let groupsQuery = supabase
    .from("facebook_groups")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (specificGroupId) {
    groupsQuery = groupsQuery.eq("id", specificGroupId);
  }

  const { data: groups } = await groupsQuery;

  if (!groups?.length) {
    return NextResponse.json({ error: "Aucun groupe actif" }, { status: 400 });
  }

  const results = [];

  for (const group of groups) {
    // Create scrape log
    const { data: log } = await serviceClient
      .from("scrape_logs")
      .insert({
        user_id: user.id,
        fb_group_id: group.id,
        status: "running",
      })
      .select()
      .single();

    let postsFound = 0;
    let postsNew = 0;
    let postsDuplicate = 0;
    let postsNotImmo = 0;

    try {
      let cursor: string | null = null;
      const maxPages = 3;

      for (let page = 0; page < maxPages; page++) {
        const url = new URL("https://facebook-scraper3.p.rapidapi.com/group/posts");
        url.searchParams.set("group_id", group.group_id);
        url.searchParams.set("sorting_order", "CHRONOLOGICAL");
        if (cursor) url.searchParams.set("cursor", cursor);

        const response = await fetch(url.toString(), {
          headers: {
            "x-rapidapi-key": rapidapiKey,
            "x-rapidapi-host": "facebook-scraper3.p.rapidapi.com",
          },
        });

        if (!response.ok) {
          throw new Error(`RapidAPI error: ${response.status}`);
        }

        const data = await response.json();
        const posts = data.posts || data.results || [];
        cursor = data.cursor || null;

        for (const post of posts) {
          postsFound++;

          const postId = post.post_id || post.id;
          const text = post.message || post.text || post.attached_post?.message || "";

          if (!text || !postId) continue;

          // Check duplicate
          const { data: existing } = await supabase
            .from("annonces")
            .select("id")
            .eq("user_id", user.id)
            .eq("fb_post_id", String(postId))
            .maybeSingle();

          if (existing) {
            postsDuplicate++;
            continue;
          }

          // Analyze with AI
          try {
            const analysis = await analyzePost(text, kimiKey);

            if (!analysis.is_real_estate) {
              postsNotImmo++;
              continue;
            }

            // Insert annonce
            await serviceClient.from("annonces").insert({
              user_id: user.id,
              fb_post_id: String(postId),
              fb_post_url: post.url || post.post_url || null,
              fb_group_id: group.id,
              fb_author_name: post.author?.name || null,
              fb_author_id: post.author?.id ? String(post.author.id) : null,
              fb_posted_at: post.timestamp
                ? new Date(post.timestamp * 1000).toISOString()
                : null,
              raw_text: text,
              raw_images: post.photo_url
                ? [post.photo_url]
                : post.images || [],
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
          } catch (aiError) {
            console.error("AI analysis error:", aiError);
            postsNotImmo++;
          }
        }

        if (!cursor) break;
      }

      // Update group last_scraped_at
      await serviceClient
        .from("facebook_groups")
        .update({ last_scraped_at: new Date().toISOString() })
        .eq("id", group.id);

      // Update scrape log
      if (log) {
        await serviceClient
          .from("scrape_logs")
          .update({
            status: "success",
            finished_at: new Date().toISOString(),
            posts_found: postsFound,
            posts_new: postsNew,
            posts_duplicate: postsDuplicate,
            posts_not_immo: postsNotImmo,
          })
          .eq("id", log.id);
      }

      results.push({
        group: group.group_name,
        postsFound,
        postsNew,
        postsDuplicate,
        postsNotImmo,
      });
    } catch (error) {
      if (log) {
        await serviceClient
          .from("scrape_logs")
          .update({
            status: "error",
            finished_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : "Unknown error",
            posts_found: postsFound,
            posts_new: postsNew,
            posts_duplicate: postsDuplicate,
            posts_not_immo: postsNotImmo,
          })
          .eq("id", log.id);
      }

      results.push({
        group: group.group_name,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ success: true, results });
}
