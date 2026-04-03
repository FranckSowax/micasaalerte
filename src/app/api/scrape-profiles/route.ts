import { createClient, createServiceClient } from "@/lib/supabase/server";
import { analyzePost } from "@/lib/ai";
import { extractImages, fetchReshareImages } from "@/lib/extract-images";
import { fetchWithRetry, sleep } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const specificAgentId = body.agentId as string | undefined;

  const serviceClient = createServiceClient();
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("rapidapi_key, kimi_api_key")
    .eq("id", user.id)
    .single();

  const rapidapiKey = profile?.rapidapi_key || process.env.RAPIDAPI_KEY;
  const kimiKey = profile?.kimi_api_key || process.env.KIMI_API_KEY;

  if (!rapidapiKey) return NextResponse.json({ error: "Clé RapidAPI non configurée" }, { status: 400 });
  if (!kimiKey) return NextResponse.json({ error: "Clé Kimi (IA) non configurée" }, { status: 400 });

  let agentsQuery = serviceClient
    .from("agent_profiles")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (specificAgentId) agentsQuery = agentsQuery.eq("id", specificAgentId);

  const { data: agents } = await agentsQuery;
  if (!agents?.length) return NextResponse.json({ error: "Aucun profil agent actif" }, { status: 400 });

  const results = [];

  for (let ai = 0; ai < agents.length; ai++) {
    const agent = agents[ai];
    if (ai > 0) await sleep(2000);
    let postsFound = 0, postsNew = 0, postsDuplicate = 0, postsNotImmo = 0, postsNoText = 0, postsError = 0;
    let apiCallsRapid = 0, apiCallsKimi = 0;
    const postDetails: Record<string, unknown>[] = [];

    try {
      let cursor: string | null = null;
      const maxPages = 3;

      for (let page = 0; page < maxPages; page++) {
        const url = new URL("https://facebook-scraper3.p.rapidapi.com/profile/posts");
        url.searchParams.set("profile_id", agent.profile_id);
        if (cursor) url.searchParams.set("cursor", cursor);

        apiCallsRapid++;
        const response = await fetchWithRetry(url.toString(), {
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
        cursor = data.cursor || data.paging?.next || null;

        for (const post of posts) {
          postsFound++;
          const postId = post.post_id || post.id;
          const text = post.message || post.text || post.attached_post?.message || "";
          const postUrl = post.url || post.post_url || post.link || null;
          const authorName = post.author?.name || post.user?.name || agent.profile_name;
          const postedAt = post.timestamp ? new Date(post.timestamp * 1000).toISOString() : post.created_time || null;

          // Extract images from all possible API response fields
          let uniqueImages = extractImages(post);
          if (uniqueImages.length === 0 && post.attached_post) {
            const reshareImages = await fetchReshareImages(post, rapidapiKey);
            if (reshareImages.length > 0) { uniqueImages = reshareImages; apiCallsRapid++; }
          }

          if (!text || !postId) {
            postsNoText++;
            postDetails.push({ postId, status: "no_text", text: "(vide)" });
            continue;
          }

          // Check duplicate
          const { data: existing } = await serviceClient
            .from("raw_posts")
            .select("id")
            .eq("user_id", user.id)
            .eq("fb_post_id", String(postId))
            .maybeSingle();

          if (existing) {
            postsDuplicate++;
            postDetails.push({ postId, status: "duplicate", text: text.substring(0, 80) });
            continue;
          }

          // Save raw post
          const { data: rawPost } = await serviceClient.from("raw_posts").insert({
            user_id: user.id,
            agent_profile_id: agent.id,
            source_type: "profile",
            fb_post_id: String(postId),
            fb_post_url: postUrl,
            fb_author_name: authorName,
            raw_text: text,
            raw_images: uniqueImages,
            fb_posted_at: postedAt,
            ai_status: "pending",
            raw_api_data: post,
          }).select().single();

          // AI analysis
          try {
            apiCallsKimi++;
            const analysis = await analyzePost(text, kimiKey);

            await serviceClient.from("raw_posts").update({
              ai_result: analysis as unknown as Record<string, unknown>,
              ai_status: analysis.is_real_estate ? "real_estate" : "not_real_estate",
            }).eq("id", rawPost?.id);

            if (!analysis.is_real_estate) {
              postsNotImmo++;
              postDetails.push({ postId, status: "not_real_estate", text: text.substring(0, 80) });
              continue;
            }

            const { data: annonce } = await serviceClient.from("annonces").insert({
              user_id: user.id,
              fb_post_id: String(postId),
              fb_post_url: postUrl,
              fb_author_name: authorName,
              fb_author_id: agent.profile_id,
              fb_posted_at: postedAt,
              raw_text: text,
              raw_images: uniqueImages,
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

            if (annonce) {
              await serviceClient.from("raw_posts").update({ annonce_id: annonce.id }).eq("id", rawPost?.id);
            }

            postsNew++;
            postDetails.push({
              postId, status: "new_annonce", text: text.substring(0, 80),
              type: `${analysis.type_offre || "?"} - ${analysis.type_bien || "?"}`,
              prix: analysis.prix, quartier: analysis.quartier,
              images: uniqueImages.length,
            });
          } catch (aiError) {
            postsError++;
            const errMsg = aiError instanceof Error ? aiError.message : "Erreur IA";
            await serviceClient.from("raw_posts").update({ ai_status: "error", ai_error: errMsg }).eq("id", rawPost?.id);
            postDetails.push({ postId, status: "ai_error", text: text.substring(0, 80), error: errMsg });
          }
        }

        if (!cursor) break;
      }

      // Update last_scraped_at
      await serviceClient.from("agent_profiles").update({ last_scraped_at: new Date().toISOString() }).eq("id", agent.id);

      results.push({
        agent: agent.profile_name, postsFound, postsNew, postsDuplicate, postsNotImmo, postsNoText, postsError,
        apiCalls: { rapidapi: apiCallsRapid, kimi: apiCallsKimi },
        details: postDetails,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      results.push({ agent: agent.profile_name, error: errMsg, apiCalls: { rapidapi: apiCallsRapid, kimi: apiCallsKimi } });
    }
  }

  return NextResponse.json({ success: true, results });
}
