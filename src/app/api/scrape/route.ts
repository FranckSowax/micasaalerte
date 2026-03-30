import { createClient, createServiceClient } from "@/lib/supabase/server";
import { analyzePost } from "@/lib/ai";
import { NextResponse } from "next/server";

export const maxDuration = 120; // Allow up to 2 min for scraping

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const specificGroupId = body.groupId as string | undefined;

  const serviceClient = createServiceClient();
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("rapidapi_key, kimi_api_key")
    .eq("id", user.id)
    .single();

  const rapidapiKey = profile?.rapidapi_key || process.env.RAPIDAPI_KEY;
  const kimiKey = profile?.kimi_api_key || process.env.KIMI_API_KEY;

  if (!rapidapiKey) {
    return NextResponse.json({ error: "Clé RapidAPI non configurée. Allez dans Paramètres pour l'ajouter." }, { status: 400 });
  }

  if (!kimiKey) {
    return NextResponse.json({ error: "Clé Kimi (IA) non configurée. Allez dans Paramètres pour l'ajouter." }, { status: 400 });
  }

  let groupsQuery = serviceClient
    .from("facebook_groups")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (specificGroupId) {
    groupsQuery = groupsQuery.eq("id", specificGroupId);
  }

  const { data: groups } = await groupsQuery;

  if (!groups?.length) {
    return NextResponse.json({ error: "Aucun groupe actif trouvé" }, { status: 400 });
  }

  const results = [];

  for (const group of groups) {
    // Create scrape log
    const { data: log } = await serviceClient
      .from("scrape_logs")
      .insert({ user_id: user.id, fb_group_id: group.id, status: "running" })
      .select()
      .single();

    const logId = log?.id;
    let postsFound = 0;
    let postsNew = 0;
    let postsDuplicate = 0;
    let postsNotImmo = 0;
    let postsNoText = 0;
    let postsError = 0;
    let apiCallsRapid = 0;
    let apiCallsKimi = 0;
    const postDetails: Record<string, unknown>[] = [];

    try {
      let cursor: string | null = null;
      const maxPages = 3;

      for (let page = 0; page < maxPages; page++) {
        const url = new URL("https://facebook-scraper3.p.rapidapi.com/group/posts");
        url.searchParams.set("group_id", group.group_id);
        url.searchParams.set("sorting_order", "CHRONOLOGICAL");
        if (cursor) url.searchParams.set("cursor", cursor);

        apiCallsRapid++;
        const response = await fetch(url.toString(), {
          headers: {
            "x-rapidapi-key": rapidapiKey,
            "x-rapidapi-host": "facebook-scraper3.p.rapidapi.com",
          },
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          throw new Error(`RapidAPI erreur ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json();
        const posts = data.posts || data.results || [];
        cursor = data.cursor || null;

        for (const post of posts) {
          postsFound++;
          const postId = post.post_id || post.id;
          const text = post.message || post.text || post.attached_post?.message || "";
          const postUrl = post.url || post.post_url || null;
          const authorName = post.author?.name || null;
          const postedAt = post.timestamp ? new Date(post.timestamp * 1000).toISOString() : null;
          const images = post.photo_url ? [post.photo_url] : post.images || [];

          // No text → skip
          if (!text || !postId) {
            postsNoText++;
            await serviceClient.from("raw_posts").upsert({
              user_id: user.id,
              fb_group_id: group.id,
              scrape_log_id: logId,
              fb_post_id: String(postId || `unknown-${Date.now()}-${postsFound}`),
              fb_post_url: postUrl,
              fb_author_name: authorName,
              raw_text: text || "(aucun texte)",
              raw_images: images,
              fb_posted_at: postedAt,
              ai_status: "no_text",
            }, { onConflict: "user_id,fb_post_id" });
            postDetails.push({ postId, status: "no_text", text: text?.substring(0, 80) || "(vide)" });
            continue;
          }

          // Check duplicate
          const { data: existing } = await serviceClient
            .from("raw_posts")
            .select("id, ai_status, annonce_id")
            .eq("user_id", user.id)
            .eq("fb_post_id", String(postId))
            .maybeSingle();

          if (existing) {
            postsDuplicate++;
            postDetails.push({ postId, status: "duplicate", text: text.substring(0, 80) });
            continue;
          }

          // Save raw post (pending)
          const { data: rawPost } = await serviceClient.from("raw_posts").insert({
            user_id: user.id,
            fb_group_id: group.id,
            scrape_log_id: logId,
            fb_post_id: String(postId),
            fb_post_url: postUrl,
            fb_author_name: authorName,
            raw_text: text,
            raw_images: images,
            fb_posted_at: postedAt,
            ai_status: "pending",
          }).select().single();

          // Analyze with AI
          try {
            apiCallsKimi++;
            const analysis = await analyzePost(text, kimiKey);

            // Update raw post with AI result
            await serviceClient.from("raw_posts").update({
              ai_result: analysis as unknown as Record<string, unknown>,
              ai_status: analysis.is_real_estate ? "real_estate" : "not_real_estate",
            }).eq("id", rawPost?.id);

            if (!analysis.is_real_estate) {
              postsNotImmo++;
              postDetails.push({
                postId,
                status: "not_real_estate",
                text: text.substring(0, 80),
                reason: analysis.summary || "Non immobilier",
              });
              continue;
            }

            // Insert annonce
            const { data: annonce } = await serviceClient.from("annonces").insert({
              user_id: user.id,
              fb_post_id: String(postId),
              fb_post_url: postUrl,
              fb_group_id: group.id,
              fb_author_name: authorName,
              fb_author_id: post.author?.id ? String(post.author.id) : null,
              fb_posted_at: postedAt,
              raw_text: text,
              raw_images: images,
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
            }).select("id").single();

            // Link raw post to annonce
            if (annonce) {
              await serviceClient.from("raw_posts").update({ annonce_id: annonce.id }).eq("id", rawPost?.id);
            }

            postsNew++;
            postDetails.push({
              postId,
              status: "new_annonce",
              text: text.substring(0, 80),
              type: `${analysis.type_offre || "?"} - ${analysis.type_bien || "?"}`,
              prix: analysis.prix,
              quartier: analysis.quartier,
            });
          } catch (aiError) {
            postsError++;
            const errMsg = aiError instanceof Error ? aiError.message : "Erreur IA";
            await serviceClient.from("raw_posts").update({
              ai_status: "error",
              ai_error: errMsg,
            }).eq("id", rawPost?.id);
            postDetails.push({ postId, status: "ai_error", text: text.substring(0, 80), error: errMsg });
          }
        }

        if (!cursor) break;
      }

      // Update group
      await serviceClient
        .from("facebook_groups")
        .update({ last_scraped_at: new Date().toISOString() })
        .eq("id", group.id);

      // Update scrape log
      if (logId) {
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
          .eq("id", logId);
      }

      results.push({
        group: group.group_name,
        postsFound,
        postsNew,
        postsDuplicate,
        postsNotImmo,
        postsNoText,
        postsError,
        apiCalls: { rapidapi: apiCallsRapid, kimi: apiCallsKimi },
        details: postDetails,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      if (logId) {
        await serviceClient
          .from("scrape_logs")
          .update({
            status: "error",
            finished_at: new Date().toISOString(),
            error_message: errMsg,
            posts_found: postsFound,
            posts_new: postsNew,
            posts_duplicate: postsDuplicate,
            posts_not_immo: postsNotImmo,
          })
          .eq("id", logId);
      }
      results.push({ group: group.group_name, error: errMsg, apiCalls: { rapidapi: apiCallsRapid, kimi: apiCallsKimi } });
    }
  }

  return NextResponse.json({ success: true, results });
}
