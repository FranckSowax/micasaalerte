import { isAIConfigured } from "@/lib/ai";
import { MAX_COMPLETED_TEXT, reanalyzeAnnonce } from "@/lib/complete-annonce";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

// L'agent complète le texte d'une annonce (collé depuis la publication d'origine) : l'annonce
// est réanalysée par l'IA et ses champs (prix, quartier, contact, équipements) sont mis à jour.

export const dynamic = "force-dynamic";

const BodySchema = z.object({ text: z.string().trim().min(20).max(MAX_COMPLETED_TEXT) });

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Collez le texte complet de la publication (20 à ${MAX_COMPLETED_TEXT} caractères).` }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("kimi_api_key").eq("id", user.id).maybeSingle();
  const legacyKey = (profile?.kimi_api_key as string | null) || null;
  if (!isAIConfigured(legacyKey)) return NextResponse.json({ error: "Aucun modèle d'IA configuré." }, { status: 503 });

  // reanalyzeAnnonce vérifie que l'annonce appartient bien à l'agent connecté.
  const result = await reanalyzeAnnonce(supabase, { annonceId: params.id, userId: user.id, text: parsed.data.text, legacyAiKey: legacyKey });
  if (!result.ok) {
    const status = result.error === "Annonce introuvable" ? 404 : 502;
    return NextResponse.json({ error: status === 404 ? result.error : "La réanalyse a échoué. Réessayez dans un instant." }, { status });
  }
  return NextResponse.json({ success: true, isRealEstate: result.isRealEstate });
}
