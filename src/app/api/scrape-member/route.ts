import { createClient, createServiceClient } from "@/lib/supabase/server";
import { analyzePost } from "@/lib/ai";
import { extractImages } from "@/lib/extract-images";
import { fetchWithRetry } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const groupId = body.groupId as string;
  const memberId = body.memberId as string;
  const memberName = body.memberName as string | undefined;

  if (!groupId || !memberId) {
    return NextResponse.json({ error: "groupId et memberId requis" }, { status: 400 });
  }

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

  let postsFound = 0, postsFromMember = 0, postsNew = 0, postsDuplicate = 0;
  let postsNotImmo = 0, postsError = 0;
  let apiCallsRapid = 0, apiCallsKimi = 0;
  const postDetails: Record<string, unknown>[] = [];

  try {
    let cursor: string | null = null;
    const maxPages = 10; // More pages to find all posts from this member

    for (let page = 0; page < maxPages; page++) {
      const url = new URL("https://facebook-scraper3.p.rapidapi.com/group/posts");
      url.searchParams.set("group_id", groupId);
      url.searchParams.set("sorting_order", "CHRONOLOGICAL");
      if (cursor) url.searchParams.set("cursor", cursor);

      apiCallsRapid++;
      const response = await fetchWithRetry(url.toString(), {
        headers: {
          "x-rapidapi-key": rapidapiKey,
          "x-rapidapi-host": "facebook-scraper3.p.rapidapi.com",
        },
      });

      if (!response.ok) {
        throw new Error(`RapidAPI erreur ${response.status}`);
      }

      const data = await response.json();
      const posts = data.posts || data.results || [];
      cursor = data.cursor || null;

      for (const post of posts) {
        postsFound++;

        // Filter: only keep posts from this specific member
        const authorId = String(post.author?.id || "");
        const authorName = post.author?.name || "";

        const isFromMember = authorId === memberId
          || authorName.toLowerCase().includes((memberName || "").toLowerCase());

        if (!isFromMember) continue;
        postsFromMember++;

        const postId = post.post_id || post.id;
        const text = post.message || post.text || post.attached_post?.message || "";
        const postUrl = post.url || post.post_url || null;
        const postedAt = post.timestamp ? new Date(post.timestamp * 1000).toISOString() : null;
        const uniqueImages = extractImages(post);

        if (!text || !postId) {
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
          source_type: "profile",
          fb_post_id: String(postId),
          fb_post_url: postUrl,
          fb_author_name: authorName || memberName || memberId,
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
            fb_author_name: authorName || memberName || memberId,
            fb_author_id: memberId,
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
            prix: analysis.prix, images: uniqueImages.length,
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
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Erreur",
      partial: { postsFound, postsFromMember, postsNew, apiCalls: { rapidapi: apiCallsRapid, kimi: apiCallsKimi } },
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    postsFound,
    postsFromMember,
    postsNew,
    postsDuplicate,
    postsNotImmo,
    postsError,
    apiCalls: { rapidapi: apiCallsRapid, kimi: apiCallsKimi },
    details: postDetails,
  });
}
