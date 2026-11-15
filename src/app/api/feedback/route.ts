import { analyzeReportedAnnonce, isAIConfigured } from "@/lib/ai";
import {
  activeReports, analysisOf, FEEDBACK_LABELS, isReport, mainReason, parseReportAnalysis, reportAnalysisPrompt,
  REPORT_REASONS, withdrawalOf, withoutWithdrawal, withReportsIgnored, withWithdrawal, type FeedbackRow, type ReportAnalysis,
} from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Annonce } from "@/types/database";

// Avis des abonnés, pour l'écran « Avis clients » de l'agent connecté.
// GET  : signalements par annonce (avec l'avis du modèle), statistiques et derniers avis.
// POST : l'agent retire l'annonce chez tous les abonnés, ignore les signalements, ou la remet en ligne.

export const dynamic = "force-dynamic";

const MAX_ROWS = 500;
const MAX_ANALYSES_PER_LOAD = 3; // appels au modèle par chargement : l'écran reste rapide

const ActionSchema = z.object({
  annonceId: z.string().uuid(),
  action: z.enum(["withdraw", "ignore", "restore"]),
  reason: z.enum(REPORT_REASONS).optional(),
});

type Row = FeedbackRow & { client_status?: string | null };
type Details = Record<string, unknown> | null;

const summary = (a: Annonce) => ({
  id: a.id,
  typeOffre: a.type_offre,
  typeBien: a.type_bien,
  prix: a.prix,
  devise: a.devise,
  quartier: a.quartier,
  ville: a.ville,
  resume: a.ai_summary || (a.raw_text || "").slice(0, 300),
  image: Array.isArray(a.raw_images) ? (a.raw_images[0] ?? null) : null,
  postUrl: a.fb_post_url,
  publishedAt: a.fb_posted_at,
  archived: a.status === "archived",
});

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { data: demandRows } = await supabase.from("client_demands").select("id, client_name, client_phone").eq("user_id", user.id);
  const demands = new Map((demandRows || []).map((d) => [d.id as string, d]));
  if (!demands.size) return NextResponse.json({ reports: [], stats: {}, recent: [], migrationNeeded: false });

  const { data: sendRows, error } = await supabase
    .from("client_demand_sends")
    .select("demand_id, annonce_id, client_feedback, client_status, decided_at")
    .in("demand_id", Array.from(demands.keys()))
    .not("client_feedback", "is", null)
    .order("decided_at", { ascending: false })
    .limit(MAX_ROWS);
  // Colonne client_feedback absente : le script SQL n'a pas été relancé.
  if (error) return NextResponse.json({ reports: [], stats: {}, recent: [], migrationNeeded: true });

  const rows = (sendRows || []) as unknown as Row[];
  const annonceIds = Array.from(new Set(rows.map((r) => r.annonce_id)));
  const { data: annonceRows } = annonceIds.length
    ? await supabase.from("annonces").select("*").eq("user_id", user.id).in("id", annonceIds)
    : { data: [] };
  const annonces = new Map(((annonceRows || []) as unknown as Annonce[]).map((a) => [a.id, a]));

  const who = (demandId: string) => {
    const d = demands.get(demandId);
    return { name: (d?.client_name as string | null) || null, phone: (d?.client_phone as string) || "" };
  };

  const stats: Record<string, number> = {};
  for (const r of rows) if (r.client_feedback) stats[r.client_feedback] = (stats[r.client_feedback] || 0) + 1;

  // Signalements regroupés par annonce : ceux encore à traiter, puis les annonces déjà retirées.
  let analyses = 0;
  const reports = [];
  for (const [annonceId, annonce] of Array.from(annonces.entries())) {
    const details = (annonce as unknown as { details?: Details }).details ?? null;
    const own = rows.filter((r) => r.annonce_id === annonceId);
    const active = activeReports(own, details);
    const withdrawal = withdrawalOf(details);
    if (!active.length && !withdrawal) continue;

    let analysis: ReportAnalysis | null = analysisOf(details);
    // L'avis du modèle est demandé une fois, puis refait si de nouveaux signalements arrivent.
    if (active.length && !withdrawal && (!analysis || analysis.reports !== active.length) && analyses < MAX_ANALYSES_PER_LOAD && isAIConfigured()) {
      analyses++;
      try {
        const raw = await analyzeReportedAnnonce(
          reportAnalysisPrompt({
            text: annonce.raw_text || annonce.ai_summary || "",
            price: annonce.prix,
            typeOffre: annonce.type_offre,
            typeBien: annonce.type_bien,
            quartier: annonce.quartier,
            publishedAt: annonce.fb_posted_at,
            reports: active.map((r) => FEEDBACK_LABELS[r.client_feedback || ""] || String(r.client_feedback)),
          })
        );
        const parsed = raw ? parseReportAnalysis(raw, active.length) : null;
        if (parsed) {
          analysis = parsed;
          await supabase.from("annonces").update({ details: { ...(details || {}), report_analysis: parsed } }).eq("id", annonceId).eq("user_id", user.id);
        }
      } catch (err) {
        console.error("Report analysis failed:", err instanceof Error ? err.message : err);
      }
    }

    reports.push({
      annonce: summary(annonce),
      count: active.length,
      suggestedReason: active.length ? mainReason(active) : (withdrawal?.reason ?? "arnaque"),
      reporters: active.map((r) => ({ ...who(r.demand_id), reason: r.client_feedback, at: r.decided_at ?? null })),
      withdrawal,
      analysis,
    });
  }
  reports.sort((a, b) => Number(!!a.withdrawal) - Number(!!b.withdrawal) || b.count - a.count);

  // Derniers avis qui portent sur l'adéquation (prix, quartier…) : utiles pour régler le matching.
  const recent = rows
    .filter((r) => !isReport(r.client_feedback) && annonces.has(r.annonce_id))
    .slice(0, 40)
    .map((r) => ({ ...who(r.demand_id), feedback: r.client_feedback, at: r.decided_at ?? null, annonce: summary(annonces.get(r.annonce_id) as Annonce) }));

  return NextResponse.json({ reports, stats, recent, migrationNeeded: false, aiConfigured: isAIConfigured() });
}

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  const { annonceId, action } = parsed.data;

  // L'annonce doit appartenir à l'agent connecté.
  const { data: annonce } = await supabase.from("annonces").select("id, status, details").eq("id", annonceId).eq("user_id", user.id).maybeSingle();
  if (!annonce) return NextResponse.json({ error: "Annonce introuvable" }, { status: 404 });
  const details = annonce.details as Details;

  const update =
    action === "withdraw"
      ? { status: "archived", details: withWithdrawal(details, parsed.data.reason ?? "arnaque", "agent") }
      : action === "ignore"
        ? { details: withReportsIgnored(details) }
        : { status: "new", details: withoutWithdrawal(details) };

  const { error } = await supabase.from("annonces").update(update).eq("id", annonceId).eq("user_id", user.id);
  if (error) {
    console.error("Feedback action failed:", error.message);
    return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
