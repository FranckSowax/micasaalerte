import { NextResponse } from "next/server";
import { verifyAnnonce } from "@/lib/annonce-verify";
import { monthlyCap, readUsage, ScraperError } from "@/lib/facebook-scraper";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Bouton « Vérifier avec RapidAPI » d'une annonce : relit la publication d'origine (1 appel),
// enregistre le verdict et répare l'annonce (texte complet, album photo).
// GET : appels utilisés ce mois-ci, pour l'affichage du bouton.

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const STATUS: Record<string, number> = { no_key: 503, auth: 502, quota: 429, budget: 429, http: 502, not_found: 404 };

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const usage = await readUsage(createServiceClient());
  return NextResponse.json({ configured: !!process.env.RAPIDAPI_KEY, used: usage.calls, cap: monthlyCap() });
}

export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("kimi_api_key").eq("id", user.id).maybeSingle();
  try {
    // verifyAnnonce ne lit que les annonces de l'agent connecté (filtre user_id).
    const outcome = await verifyAnnonce(service, id, user.id, { legacyAiKey: (profile?.kimi_api_key as string | null) || null });
    const usage = await readUsage(service);
    return NextResponse.json({ ...outcome, used: usage.calls, cap: monthlyCap() });
  } catch (error) {
    if (error instanceof ScraperError) return NextResponse.json({ error: error.message }, { status: STATUS[error.code] ?? 502 });
    console.error("verify annonce:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "La vérification a échoué. Réessayez dans un instant." }, { status: 500 });
  }
}
