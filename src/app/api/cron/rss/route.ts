import { createServiceClient } from "@/lib/supabase/server";
import { isAIConfigured } from "@/lib/ai";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { ingestPost } from "@/lib/ingest";
import { configuredFeedUrls, parseFeed, type FeedPost } from "@/lib/rss-feed";
import { NextResponse } from "next/server";

// Collecte des groupes Facebook par flux rss.app (RSS_FEED_URLS).
// Appelée en POST par le service cron Railway ; GET accepté pour un déclenchement manuel.
export const dynamic = "force-dynamic";
export const GET = handleCron;
export const POST = handleCron;

const FEED_TIMEOUT_MS = 30_000;
// Borne la durée d'un passage : au-delà, le reste est traité au passage suivant.
const MAX_ANALYSES_PER_RUN = 120;

interface GroupRow {
  id: string;
  user_id: string;
  group_id: string;
  group_name: string;
  profiles: { kimi_api_key: string | null } | null;
}

async function handleCron(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const feedUrls = configuredFeedUrls();
  if (!feedUrls.length) {
    return NextResponse.json({ error: "RSS_FEED_URLS non configuré" }, { status: 503 });
  }

  const client = createServiceClient();

  const { data: groupRows } = await client
    .from("facebook_groups")
    .select("id, user_id, group_id, group_name, profiles!inner(kimi_api_key)")
    .eq("is_active", true);

  // Un même groupe Facebook peut être suivi par plusieurs comptes.
  const groupsByFacebookId = new Map<string, GroupRow[]>();
  for (const row of (groupRows || []) as unknown as GroupRow[]) {
    groupsByFacebookId.set(row.group_id, [...(groupsByFacebookId.get(row.group_id) || []), row]);
  }

  const stats = { posts: 0, newAnnonces: 0, notRealEstate: 0, known: 0, aiErrors: 0, empty: 0, deferred: 0 };
  const unknownGroups: Record<string, number> = {};
  const feeds: { items: number; spanMinutes: number | null; possibleGap: boolean; error?: string }[] = [];
  const touchedGroups = new Set<string>();
  // Messages d'erreur distincts de l'IA, avec leur nombre : sans eux un échec en série est illisible.
  const aiErrorMessages: Record<string, number> = {};
  let analyses = 0;

  for (const feedUrl of feedUrls) {
    let posts: FeedPost[];
    try {
      const response = await fetch(feedUrl, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      posts = parseFeed(await response.json());
    } catch (error) {
      // L'adresse du flux n'est pas journalisée : elle donne accès au flux à qui la connaît.
      feeds.push({ items: 0, spanMinutes: null, possibleGap: false, error: error instanceof Error ? error.message : "erreur" });
      continue;
    }

    const times = posts.map((p) => (p.publishedAt ? Date.parse(p.publishedAt) : NaN)).filter((t) => !Number.isNaN(t));
    const spanMinutes = times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 60_000) : null;
    // Si la plus ancienne publication du flux est nouvelle pour nous, des publications
    // encore plus anciennes ont pu sortir du flux avant d'être lues.
    let oldestWasNew: boolean | null = null;
    // Même texte publié plusieurs fois de suite par le même auteur : analysé une seule fois.
    const seenTexts = new Set<string>();

    for (const post of posts) {
      stats.posts++;
      const owners = groupsByFacebookId.get(post.groupId);
      if (!owners?.length) {
        unknownGroups[post.groupId] = (unknownGroups[post.groupId] || 0) + 1;
        continue;
      }
      if (!post.text) {
        stats.empty++;
        continue;
      }

      const textKey = `${post.groupId}:${post.author}:${post.text}`;
      const repeated = seenTexts.has(textKey);
      seenTexts.add(textKey);

      for (const group of owners) {
        touchedGroups.add(group.id);
        if (repeated) {
          stats.known++;
          continue;
        }
        if (!isAIConfigured(group.profiles?.kimi_api_key)) {
          stats.aiErrors++;
          continue;
        }
        if (analyses >= MAX_ANALYSES_PER_RUN) {
          stats.deferred++;
          continue;
        }

        const status = await ingestPost(client, {
          userId: group.user_id,
          groupRowId: group.id,
          groupName: group.group_name,
          postId: post.postId,
          url: post.url,
          author: post.author,
          text: post.text,
          images: post.images,
          publishedAt: post.publishedAt,
          legacyAiKey: group.profiles?.kimi_api_key,
          onAiError: (message) => {
            const key = message.slice(0, 220);
            aiErrorMessages[key] = (aiErrorMessages[key] || 0) + 1;
          },
        });

        if (oldestWasNew === null) oldestWasNew = status !== "known";
        if (status === "known") stats.known++;
        else {
          analyses++;
          if (status === "new_annonce") stats.newAnnonces++;
          else if (status === "not_real_estate") stats.notRealEstate++;
          else stats.aiErrors++;
        }
      }
    }

    feeds.push({ items: posts.length, spanMinutes, possibleGap: oldestWasNew === true });
  }

  if (touchedGroups.size) {
    await client
      .from("facebook_groups")
      .update({ last_scraped_at: new Date().toISOString() })
      .in("id", Array.from(touchedGroups));
  }

  return NextResponse.json({ success: true, ...stats, feeds, unknownGroups, aiErrorMessages });
}
