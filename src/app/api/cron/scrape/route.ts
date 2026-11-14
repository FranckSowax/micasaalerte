import { createServiceClient } from "@/lib/supabase/server";
import { analyzePost, isAIConfigured } from "@/lib/ai";
import { annonceFieldsFromAnalysis } from "@/lib/annonce-fields";
import { fetchWithRetry, sleep } from "@/lib/rate-limit";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { NextResponse } from "next/server";

// Appelée en POST par scripts/run-cron.mjs (service cron Railway) ; GET accepté aussi pour un déclenchement manuel.
export const dynamic = "force-dynamic";
export const GET = handleCron;
export const POST = handleCron;

async function handleCron(request: Request) {
  if (!isAuthorizedCron(request)) {
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
  let rapidApiCalls = 0;

  for (const group of groups) {
    const profile = (group as Record<string, unknown>).profiles as {
      rapidapi_key: string | null;
      kimi_api_key: string | null;
    };
    const rapidapiKey = profile?.rapidapi_key || process.env.RAPIDAPI_KEY;
    const kimiKey = profile?.kimi_api_key || process.env.KIMI_API_KEY;

    if (!rapidapiKey) continue;
    // Sans IA, chaque appel RapidAPI serait payé pour rien.
    if (!isAIConfigured(kimiKey)) {
      results.push({ group: group.group_name, error: "IA non configurée" });
      continue;
    }

    await sleep(2000); // Rate limit between groups
    let postsNew = 0;
    let postsSkipped = 0;
    let aiErrors = 0;

    try {
      const url = new URL("https://facebook-scraper3.p.rapidapi.com/group/posts");
      url.searchParams.set("group_id", group.group_id);
      url.searchParams.set("sorting_order", "CHRONOLOGICAL");

      rapidApiCalls++;
      const response = await fetchWithRetry(url.toString(), {
        headers: {
          "x-rapidapi-key": rapidapiKey,
          "x-rapidapi-host": "facebook-scraper3.p.rapidapi.com",
        },
      });

      if (!response.ok) {
        // Le corps de la réponse dit pourquoi (abonnement, quota, clé) : on le remonte, tronqué.
        const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        results.push({ group: group.group_name, error: `RapidAPI ${response.status}${detail ? ` : ${detail}` : ""}` });
        continue;
      }

      const data = await response.json();
      const posts = data.posts || data.results || [];

      for (const post of posts) {
        const postId = post.post_id || post.id;
        const text = post.message || post.text || "";
        if (!text || !postId) continue;

        // WHY: on mémorise chaque post dans raw_posts, y compris les non-immobiliers.
        // Sans cela, un cron horaire renverrait les mêmes posts à l'IA à chaque passage.
        // Un post en erreur IA (ou resté "pending") est retenté au passage suivant.
        const { data: seen } = await serviceClient
          .from("raw_posts")
          .select("id, ai_status")
          .eq("user_id", group.user_id)
          .eq("fb_post_id", String(postId))
          .maybeSingle();

        if (seen && seen.ai_status !== "error" && seen.ai_status !== "pending") {
          postsSkipped++;
          continue;
        }

        const { data: existing } = await serviceClient
          .from("annonces")
          .select("id")
          .eq("user_id", group.user_id)
          .eq("fb_post_id", String(postId))
          .maybeSingle();

        if (existing) {
          postsSkipped++;
          continue;
        }

        const postedAt = post.timestamp ? new Date(post.timestamp * 1000).toISOString() : null;
        let rawPostId = seen?.id as string | undefined;
        if (!rawPostId) {
          const { data: rawPost } = await serviceClient
            .from("raw_posts")
            .insert({
              user_id: group.user_id,
              fb_group_id: group.id,
              source_type: "group",
              fb_post_id: String(postId),
              fb_post_url: post.url || null,
              fb_author_name: post.author?.name || null,
              raw_text: text,
              raw_images: post.photo_url ? [post.photo_url] : [],
              fb_posted_at: postedAt,
              ai_status: "pending",
            })
            .select("id")
            .single();
          rawPostId = rawPost?.id as string | undefined;
        }

        try {
          const analysis = await analyzePost(text, kimiKey);

          if (rawPostId) {
            await serviceClient
              .from("raw_posts")
              .update({
                ai_result: analysis as unknown as Record<string, unknown>,
                ai_status: analysis.is_real_estate ? "real_estate" : "not_real_estate",
                ai_error: null,
              })
              .eq("id", rawPostId);
          }

          if (!analysis.is_real_estate) continue;

          const { data: annonce } = await serviceClient.from("annonces").insert({
            user_id: group.user_id,
            fb_post_id: String(postId),
            fb_post_url: post.url || null,
            fb_group_id: group.id,
            fb_author_name: post.author?.name || null,
            fb_author_id: post.author?.id ? String(post.author.id) : null,
            fb_posted_at: postedAt,
            raw_text: text,
            raw_images: post.photo_url ? [post.photo_url] : [],
            ...(await annonceFieldsFromAnalysis(serviceClient, analysis)),
          }).select("id").single();

          if (annonce && rawPostId) {
            await serviceClient.from("raw_posts").update({ annonce_id: annonce.id }).eq("id", rawPostId);
          }
          postsNew++;
        } catch (aiError) {
          aiErrors++;
          if (rawPostId) {
            await serviceClient
              .from("raw_posts")
              .update({
                ai_status: "error",
                ai_error: aiError instanceof Error ? aiError.message.slice(0, 500) : "Erreur IA",
              })
              .eq("id", rawPostId);
          }
        }
      }

      await serviceClient
        .from("facebook_groups")
        .update({ last_scraped_at: new Date().toISOString() })
        .eq("id", group.id);

      results.push({ group: group.group_name, postsFound: posts.length, postsNew, postsSkipped, aiErrors });
    } catch (error) {
      results.push({ group: group.group_name, error: error instanceof Error ? error.message : "Unknown" });
    }
  }

  return NextResponse.json({ success: true, groups: groups.length, rapidApiCalls, results });
}
