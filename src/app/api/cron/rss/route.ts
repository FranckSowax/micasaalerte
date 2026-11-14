import { createServiceClient } from "@/lib/supabase/server";
import { isAIConfigured } from "@/lib/ai";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { ingestPost, reprocessPending } from "@/lib/ingest";
import { configuredFeedUrls, parseFeed, type FeedPost } from "@/lib/rss-feed";
import { NextResponse } from "next/server";

// Collecte des groupes et des profils d'agents Facebook par flux rss.app (RSS_FEED_URLS).
// Appelée en POST par le service cron Railway ; GET accepté pour un déclenchement manuel.
export const dynamic = "force-dynamic";
export const GET = handleCron;
export const POST = handleCron;

const FEED_TIMEOUT_MS = 30_000;
// Borne la durée d'un passage : au-delà, le reste est traité au passage suivant.
const MAX_ANALYSES_PER_RUN = 120;

/** Source enregistrée dans l'application : un groupe ou un profil d'agent d'un compte. */
interface SourceRow {
  id: string;
  userId: string;
  name: string;
  aiKey: string | null;
}

type OwnerProfile = { kimi_api_key: string | null } | null;

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

  const { data: agentRows } = await client
    .from("agent_profiles")
    .select("id, user_id, profile_id, profile_name, profiles!inner(kimi_api_key)")
    .eq("is_active", true);

  // Une même source Facebook peut être suivie par plusieurs comptes.
  // Clé : « group:<id> » ou « profile:<id ou nom d'utilisateur en minuscules> ».
  const sources = new Map<string, SourceRow[]>();
  const addSource = (key: string, row: SourceRow) => sources.set(key, [...(sources.get(key) || []), row]);

  for (const g of (groupRows || []) as unknown as { id: string; user_id: string; group_id: string; group_name: string; profiles: OwnerProfile }[]) {
    addSource(`group:${g.group_id}`, { id: g.id, userId: g.user_id, name: g.group_name, aiKey: g.profiles?.kimi_api_key ?? null });
  }
  for (const a of (agentRows || []) as unknown as { id: string; user_id: string; profile_id: string; profile_name: string; profiles: OwnerProfile }[]) {
    addSource(`profile:${a.profile_id.toLowerCase()}`, { id: a.id, userId: a.user_id, name: a.profile_name, aiKey: a.profiles?.kimi_api_key ?? null });
  }

  const stats = { posts: 0, newAnnonces: 0, notRealEstate: 0, outOfArea: 0, known: 0, aiErrors: 0, empty: 0, deferred: 0 };
  const unknownSources: Record<string, number> = {};
  const touchedAgents = new Set<string>();
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
    // Si la plus ancienne publication du flux n'avait jamais été vue, des publications
    // encore plus anciennes ont pu sortir du flux avant d'être lues. Une publication déjà
    // vue mais retentée après une erreur IA ne compte pas : elle donnait de fausses alertes.
    let oldestChecked = false;
    let oldestWasNew = false;
    // Même texte publié plusieurs fois de suite par le même auteur : analysé une seule fois.
    const seenTexts = new Set<string>();

    for (const post of posts) {
      stats.posts++;
      const sourceKey = `${post.kind}:${post.sourceId.toLowerCase()}`;
      const owners = sources.get(sourceKey);
      if (!owners?.length) {
        // Pour un profil, on ajoute le nom de l'auteur : c'est lui qu'il faut enregistrer comme agent.
        const label = post.kind === "profile" ? `${sourceKey} (${post.author || "?"})` : sourceKey;
        unknownSources[label] = (unknownSources[label] || 0) + 1;
        continue;
      }
      if (!post.text) {
        stats.empty++;
        continue;
      }

      const textKey = `${sourceKey}:${post.author}:${post.text}`;
      const repeated = seenTexts.has(textKey);
      seenTexts.add(textKey);

      for (const source of owners) {
        (post.kind === "group" ? touchedGroups : touchedAgents).add(source.id);
        if (repeated) {
          stats.known++;
          continue;
        }
        if (!isAIConfigured(source.aiKey)) {
          stats.aiErrors++;
          continue;
        }
        if (analyses >= MAX_ANALYSES_PER_RUN) {
          stats.deferred++;
          continue;
        }

        const status = await ingestPost(client, {
          userId: source.userId,
          sourceType: post.kind,
          sourceRowId: source.id,
          authorId: post.kind === "profile" ? post.sourceId : null,
          postId: post.postId,
          url: post.url,
          author: post.author,
          text: post.text,
          images: post.images,
          publishedAt: post.publishedAt,
          legacyAiKey: source.aiKey,
          onFirstSeen: () => {
            if (!oldestChecked) oldestWasNew = true;
          },
          onAiError: (message) => {
            const key = message.slice(0, 220);
            aiErrorMessages[key] = (aiErrorMessages[key] || 0) + 1;
          },
        });

        oldestChecked = true;
        if (status === "known") stats.known++;
        else {
          analyses++;
          if (status === "new_annonce") stats.newAnnonces++;
          else if (status === "not_real_estate") stats.notRealEstate++;
          else if (status === "out_of_area") stats.outOfArea++;
          else stats.aiErrors++;
        }
      }
    }

    feeds.push({ items: posts.length, spanMinutes, possibleGap: oldestWasNew });
  }

  // Rattrapage : publications mémorisées restées en attente ou en erreur, même sorties du flux.
  const recordAiError = (message: string) => {
    const key = message.slice(0, 220);
    aiErrorMessages[key] = (aiErrorMessages[key] || 0) + 1;
  };
  const reprocessed = await reprocessPending(client, MAX_ANALYSES_PER_RUN - analyses, recordAiError);

  if (touchedGroups.size) {
    await client
      .from("facebook_groups")
      .update({ last_scraped_at: new Date().toISOString() })
      .in("id", Array.from(touchedGroups));
  }
  if (touchedAgents.size) {
    await client
      .from("agent_profiles")
      .update({ last_scraped_at: new Date().toISOString() })
      .in("id", Array.from(touchedAgents));
  }

  return NextResponse.json({ success: true, ...stats, reprocessed, feeds, unknownSources, aiErrorMessages });
}
