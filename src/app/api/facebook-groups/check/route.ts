import { NextResponse } from "next/server";
import { z } from "zod";
import { analysePost, type AnalysisResult } from "@/lib/ad-quality";
import { createScraper, monthlyCap, readUsage, reserveCall, ScraperError } from "@/lib/facebook-scraper";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Contrôle qualité d'un groupe Facebook par RapidAPI : lit les dernières publications
// (≈ 3 par appel), écarte celles déjà analysées et classe le reste, la pire note d'abord.
// Usage ponctuel : chaque page coûte un appel du forfait mensuel.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  groupUrl: z.string().trim().min(5).max(300),
  maxPages: z.number().int().min(1).max(5).optional(),
  /** Secondes Unix : ignore les publications plus anciennes. */
  since: z.number().int().positive().optional(),
});

const STATUS: Record<string, number> = { no_key: 503, auth: 502, quota: 429, budget: 429, http: 502, not_found: 404 };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Adresse du groupe invalide." }, { status: 400 });
  const { groupUrl, maxPages = 2, since } = parsed.data;
  if (!/facebook\.com\/groups\/|^\d{5,}$/i.test(groupUrl)) {
    return NextResponse.json({ error: "Indiquez l'adresse d'un groupe Facebook (facebook.com/groups/…)." }, { status: 400 });
  }

  const service = createServiceClient();
  const scraper = createScraper({ beforeRequest: () => reserveCall(service) });
  try {
    const { groupId, posts } = await scraper.fetchRecentPosts(groupUrl, { maxPages, since, maxPosts: maxPages * 5 });
    if (!posts.length) {
      return NextResponse.json({ error: "Aucune publication lisible : le groupe est peut-être privé ou vide.", groupId, requestsUsed: scraper.requestsUsed() }, { status: 404 });
    }

    const ids = posts.map((p) => String(p.post_id ?? "")).filter(Boolean);
    const { data: done } = await service.from("fb_group_posts_checks").select("post_id").in("post_id", ids);
    const already = new Set(((done || []) as { post_id: string }[]).map((d) => d.post_id));
    const fresh = posts.filter((p) => p.post_id && !already.has(String(p.post_id)));

    const results: AnalysisResult[] = fresh.map((p) => analysePost(p));
    if (results.length) {
      const now = new Date().toISOString();
      const rows = results.map((r, i) => ({
        post_id: r.post_id, group_id: groupId, url: r.url, status: r.status, score: r.score,
        issues: r.issues, extracted: r.extracted, raw: fresh[i], trigger: "group", checked_at: now,
      }));
      const { error } = await service.from("fb_group_posts_checks").upsert(rows, { onConflict: "post_id" });
      if (error) console.error("fb_group_posts_checks:", error.message);
    }

    results.sort((a, b) => (a.status === "NOT_AD" ? 1 : 0) - (b.status === "NOT_AD" ? 1 : 0) || a.score - b.score);
    const count = (s: AnalysisResult["status"]) => results.filter((r) => r.status === s).length;
    const usage = await readUsage(service);
    console.log(`facebook-groups/check : ${scraper.requestsUsed()} appel(s) RapidAPI`);
    return NextResponse.json({
      groupId,
      requestsUsed: scraper.requestsUsed(),
      monthly: { used: usage.calls, cap: monthlyCap() },
      analysed: results.length,
      skipped: posts.length - fresh.length,
      summary: { ok: count("OK"), incomplete: count("INCOMPLETE"), rejected: count("REJECTED"), notAd: count("NOT_AD") },
      results,
    });
  } catch (error) {
    if (error instanceof ScraperError) {
      return NextResponse.json({ error: error.message, requestsUsed: scraper.requestsUsed() }, { status: STATUS[error.code] ?? 502 });
    }
    console.error("facebook-groups/check:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Le contrôle du groupe a échoué." }, { status: 500 });
  }
}
