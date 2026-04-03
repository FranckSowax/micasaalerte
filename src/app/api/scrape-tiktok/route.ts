import { createClient, createServiceClient } from "@/lib/supabase/server";
import { analyzePost } from "@/lib/ai";
import { fetchWithRetry } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const accountId = body.accountId as string;

  if (!accountId) return NextResponse.json({ error: "accountId requis" }, { status: 400 });

  const serviceClient = createServiceClient();

  // Get TikTok account
  const { data: account } = await serviceClient
    .from("tiktok_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();

  if (!account) return NextResponse.json({ error: "Compte TikTok non trouvé" }, { status: 404 });

  // Get API keys
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("rapidapi_key, kimi_api_key")
    .eq("id", user.id)
    .single();

  const rapidapiKey = (profile as Record<string, unknown>)?.rapidapi_key as string || process.env.RAPIDAPI_KEY;
  const kimiKey = (profile as Record<string, unknown>)?.kimi_api_key as string || process.env.KIMI_API_KEY;

  if (!rapidapiKey) return NextResponse.json({ error: "Clé RapidAPI non configurée" }, { status: 400 });
  if (!kimiKey) return NextResponse.json({ error: "Clé Kimi non configurée" }, { status: 400 });

  const handle = (account as Record<string, unknown>).tiktok_handle as string;
  let secUid = (account as Record<string, unknown>).sec_uid as string | null;

  let postsFound = 0, postsNew = 0, postsDuplicate = 0, postsNotImmo = 0, postsNoText = 0, postsError = 0;
  let apiCallsRapid = 0, apiCallsKimi = 0;
  const postDetails: Record<string, unknown>[] = [];

  try {
    // Step 1: Get secUid if not stored
    if (!secUid) {
      apiCallsRapid++;
      const infoRes = await fetchWithRetry(
        `https://tiktok-api23.p.rapidapi.com/api/user/info?uniqueId=${encodeURIComponent(handle)}`,
        {
          headers: {
            "x-rapidapi-key": rapidapiKey,
            "x-rapidapi-host": "tiktok-api23.p.rapidapi.com",
          },
        }
      );

      if (!infoRes.ok) {
        throw new Error(`TikTok User Info erreur ${infoRes.status}`);
      }

      const infoData = await infoRes.json();
      secUid = infoData?.userInfo?.user?.secUid || infoData?.user?.secUid || null;

      if (!secUid) {
        throw new Error(`Impossible de trouver le secUid pour @${handle}. Vérifiez le nom d'utilisateur.`);
      }

      // Store secUid for future use
      await serviceClient.from("tiktok_accounts").update({ sec_uid: secUid }).eq("id", accountId);
    }

    // Step 2: Get user posts (paginated)
    // First scrape: only videos from last 7 days
    // Subsequent scrapes: only videos since last scrape
    const lastScrapedAt = (account as Record<string, unknown>).last_scraped_at as string | null;
    const cutoffDate = lastScrapedAt
      ? new Date(lastScrapedAt)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    let cursor = 0;
    const maxPages = 3;
    let reachedOldPosts = false;

    for (let page = 0; page < maxPages; page++) {
      if (reachedOldPosts) break;
      apiCallsRapid++;
      const postsRes = await fetchWithRetry(
        `https://tiktok-api23.p.rapidapi.com/api/user/posts?secUid=${encodeURIComponent(secUid)}&count=35&cursor=${cursor}`,
        {
          headers: {
            "x-rapidapi-key": rapidapiKey,
            "x-rapidapi-host": "tiktok-api23.p.rapidapi.com",
          },
        }
      );

      if (!postsRes.ok) {
        throw new Error(`TikTok Posts erreur ${postsRes.status}`);
      }

      const postsData = await postsRes.json();
      // TikTok API can return items at root level or nested in data
      const root = postsData?.data || postsData;
      const items = root?.itemList || root?.items || [];
      const hasMore = root?.hasMore;
      cursor = root?.cursor || 0;

      if (!items.length) break;

      for (const item of items) {
        const videoId = item.id || String(item.video?.id || "");
        const desc = item.desc || "";
        const createTime = item.createTime ? new Date(item.createTime * 1000).toISOString() : null;
        const author = item.author?.uniqueId || handle;

        // Skip videos older than cutoff (posts are sorted newest first)
        if (item.createTime && new Date(item.createTime * 1000) < cutoffDate) {
          reachedOldPosts = true;
          break;
        }

        postsFound++;

        // Extract images (video thumbnails)
        const images: string[] = [];
        if (item.video?.cover) images.push(item.video.cover);
        if (item.video?.originCover) images.push(item.video.originCover);
        if (item.video?.dynamicCover) images.push(item.video.dynamicCover);
        const uniqueImages = Array.from(new Set(images.filter(Boolean)));

        // Video URL
        const videoUrl = `https://www.tiktok.com/@${author}/video/${videoId}`;

        if (!desc || !videoId) {
          postsNoText++;
          postDetails.push({ postId: videoId, status: "no_text", text: "(sans description)" });
          continue;
        }

        // Check duplicate
        const { data: existing } = await serviceClient
          .from("raw_posts")
          .select("id")
          .eq("user_id", user.id)
          .eq("fb_post_id", `tiktok_${videoId}`)
          .maybeSingle();

        if (existing) {
          postsDuplicate++;
          postDetails.push({ postId: videoId, status: "duplicate", text: desc.substring(0, 80) });
          continue;
        }

        // Save raw post
        const { data: rawPost } = await serviceClient.from("raw_posts").insert({
          user_id: user.id,
          source_type: "tiktok",
          fb_post_id: `tiktok_${videoId}`,
          fb_post_url: videoUrl,
          fb_author_name: `@${author}`,
          raw_text: desc,
          raw_images: uniqueImages,
          fb_posted_at: createTime,
          ai_status: "pending",
          raw_api_data: item,
        }).select().single();

        // AI analysis
        try {
          apiCallsKimi++;
          const analysis = await analyzePost(desc, kimiKey);

          await serviceClient.from("raw_posts").update({
            ai_result: analysis as unknown as Record<string, unknown>,
            ai_status: analysis.is_real_estate ? "real_estate" : "not_real_estate",
          }).eq("id", rawPost?.id);

          if (!analysis.is_real_estate) {
            postsNotImmo++;
            postDetails.push({ postId: videoId, status: "not_real_estate", text: desc.substring(0, 80) });
            continue;
          }

          const { data: annonce } = await serviceClient.from("annonces").insert({
            user_id: user.id,
            fb_post_id: `tiktok_${videoId}`,
            fb_post_url: videoUrl,
            fb_author_name: `@${author}`,
            fb_posted_at: createTime,
            raw_text: desc,
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
            postId: videoId, status: "new_annonce", text: desc.substring(0, 80),
            type: `${analysis.type_offre || "?"} - ${analysis.type_bien || "?"}`,
            prix: analysis.prix, images: uniqueImages.length,
          });
        } catch (aiError) {
          postsError++;
          const errMsg = aiError instanceof Error ? aiError.message : "Erreur IA";
          await serviceClient.from("raw_posts").update({ ai_status: "error", ai_error: errMsg }).eq("id", rawPost?.id);
          postDetails.push({ postId: videoId, status: "ai_error", text: desc.substring(0, 80), error: errMsg });
        }
      }

      if (!hasMore) break;
    }

    // Update account stats
    await serviceClient.from("tiktok_accounts").update({
      last_scraped_at: new Date().toISOString(),
      posts_found: postsFound,
      annonces_created: postsNew,
    }).eq("id", accountId);

  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Erreur",
      account: handle, postsFound, postsNew,
      apiCalls: { rapidapi: apiCallsRapid, kimi: apiCallsKimi },
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    account: `@${handle}`,
    postsFound, postsNew, postsDuplicate, postsNotImmo, postsNoText, postsError,
    apiCalls: { rapidapi: apiCallsRapid, kimi: apiCallsKimi },
    details: postDetails,
  });
}
