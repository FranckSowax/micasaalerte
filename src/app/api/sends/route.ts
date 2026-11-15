import { applyLearning, EMPTY_PROFILE, type LearnedProfile } from "@/lib/learning";
import { matchDemand, demandPreferences } from "@/lib/matching";
import { loadLearnedProfile } from "@/lib/selection";
import { withdrawalOf } from "@/lib/reports";
import { annonceVersion, doubtLabels, REVIEW_DISMISSED } from "@/lib/review";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { Annonce, ClientDemand } from "@/types/database";

// Journal des envois aux abonnés de l'agent connecté (écran « Envois ») : pour chaque annonce
// envoyée, son parcours (collecte, analyse, envoi, réaction de l'abonné) et le détail du matching.
// Lecture seule.

export const dynamic = "force-dynamic";

const MAX_SENDS = 300;

const BLOCK_LABELS: Record<string, string> = {
  transaction: "Location / vente différente",
  type: "Type de bien différent",
  budget_min: "Prix sous le budget minimum",
  budget_max: "Prix au-dessus du budget",
  chambres: "Pas assez de chambres",
  ville: "Autre ville",
  equipement: "Équipement indispensable absent",
};

type Row = Record<string, unknown>;

/** Par quel chemin l'annonce est arrivée chez l'abonné. */
function channel(send: Row): { id: string; label: string } {
  if (send.message_id === REVIEW_DISMISSED) return { id: "dismissed", label: "Écartée par vous (non envoyée)" };
  if (send.status === "failed") return { id: "failed", label: "Envoi WhatsApp échoué" };
  if (send.message_id === "criteria_refresh") return { id: "refresh", label: "Ajoutée après modification des critères (sans message)" };
  return { id: "whatsapp", label: "Message WhatsApp avec le lien de l'espace" };
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { data: demandRows } = await supabase.from("client_demands").select("*").eq("user_id", user.id);
  const demands = new Map(((demandRows || []) as unknown as ClientDemand[]).map((d) => [d.id, d]));
  if (!demands.size) return NextResponse.json({ sends: [], clients: [], messages: 0 });

  const { data: sendRows } = await supabase
    .from("client_demand_sends")
    .select("*")
    .in("demand_id", Array.from(demands.keys()))
    .order("sent_at", { ascending: false })
    .limit(MAX_SENDS);
  const sends = (sendRows || []) as Row[];

  const annonceIds = Array.from(new Set(sends.map((s) => s.annonce_id as string)));
  const { data: annonceRows } = annonceIds.length
    ? await supabase.from("annonces").select("*").eq("user_id", user.id).in("id", annonceIds)
    : { data: [] };
  const annonces = new Map(((annonceRows || []) as unknown as Annonce[]).map((a) => [a.id, a]));

  // Un même message WhatsApp porte plusieurs annonces : on le compte une fois.
  const perMessage = new Map<string, number>();
  for (const s of sends) {
    const id = s.message_id as string | null;
    if (id && channel(s).id === "whatsapp") perMessage.set(id, (perMessage.get(id) || 0) + 1);
  }

  // Apprentissage par abonné, à partir de ses avis : il entre dans le score affiché.
  const profiles = new Map<string, LearnedProfile>();
  for (const demandId of Array.from(demands.keys())) {
    profiles.set(demandId, await loadLearnedProfile(supabase, sends.filter((s) => s.demand_id === demandId)));
  }

  const items = [];
  for (const send of sends) {
    const demand = demands.get(send.demand_id as string);
    const annonce = annonces.get(send.annonce_id as string);
    if (!demand || !annonce) continue;

    // Matching recalculé avec les critères ACTUELS de l'abonné : s'il les a changés depuis
    // l'envoi, le résultat peut différer de celui du jour de l'envoi.
    const match = applyLearning(matchDemand(annonce, demand), annonce, profiles.get(demand.id) ?? EMPTY_PROFILE);
    const details = (annonce as unknown as { details?: Record<string, unknown> | null }).details ?? null;
    const via = channel(send);
    const messageId = (send.message_id as string | null) || null;

    items.push({
      id: send.id,
      sentAt: send.sent_at ?? null,
      demandId: demand.id,
      client: { name: demand.client_name, phone: demand.client_phone },
      via,
      messageSize: via.id === "whatsapp" && messageId ? perMessage.get(messageId) || 1 : 0,
      clientStatus: (send.client_status as string | null) || "new",
      feedback: (send.client_feedback as string | null | undefined) ?? null,
      decidedAt: (send.decided_at as string | null | undefined) ?? null,
      annonce: {
        id: annonce.id,
        source: String(annonce.fb_post_id || "").startsWith("tiktok_") ? "TikTok" : "Facebook",
        postUrl: annonce.fb_post_url,
        publishedAt: annonce.fb_posted_at,
        collectedAt: annonce.created_at,
        typeOffre: annonce.type_offre,
        typeBien: annonce.type_bien,
        prix: annonce.prix,
        devise: annonce.devise,
        quartier: annonce.quartier,
        ville: annonce.ville,
        chambres: annonce.nb_chambres,
        meuble: annonce.meuble,
        resume: annonce.ai_summary || (annonce.raw_text || "").slice(0, 300),
        image: Array.isArray(annonce.raw_images) ? (annonce.raw_images[0] ?? null) : null,
        photos: Array.isArray(annonce.raw_images) ? annonce.raw_images.length : 0,
        version: annonceVersion(annonce),
        withdrawn: annonce.status === "archived" ? (withdrawalOf(details)?.reason ?? "archivée") : null,
      },
      match: {
        score: match.score,
        minScore: demandPreferences(demand).minScore,
        eligible: match.eligible,
        blockedBy: match.blockedBy.map((b) => BLOCK_LABELS[b] || b),
        missing: doubtLabels(match.uncertain),
        reasons: match.reasons,
      },
    });
  }

  const clients = Array.from(demands.values()).map((d) => ({ id: d.id, name: d.client_name, phone: d.client_phone }));
  return NextResponse.json({ sends: items, clients, messages: perMessage.size });
}
