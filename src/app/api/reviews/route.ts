import { createClient, createServiceClient } from "@/lib/supabase/server";
import { clientLink, generateAccessToken } from "@/lib/client-access";
import { annonceVersion, pendingReviews, REVIEW_DISMISSED, type SendKey } from "@/lib/review";
import { formatClientLinkMessage, isWahaConfigured, sendWhatsAppMessage, clientLinkImage } from "@/lib/whatsapp";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Annonce, ClientDemand } from "@/types/database";

// Annonces « à vérifier » de l'agent connecté (écran /verifications).
// GET  : liste des couples client + annonce retenus par le cron faute d'un champ décisif.
// POST : l'agent envoie l'annonce au client, ou l'écarte pour ce client.

export const dynamic = "force-dynamic";

const RECENT_ANNONCES = 200;

const ActionSchema = z.object({
  demandId: z.string().uuid(),
  annonceId: z.string().uuid(),
  action: z.enum(["send", "dismiss"]),
});

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Envois déjà enregistrés pour ces clients ; tolère une base sans la colonne annonce_version. */
async function loadSends(supabase: Supabase, demandIds: string[]): Promise<SendKey[]> {
  if (!demandIds.length) return [];
  const withVersion = await supabase.from("client_demand_sends").select("demand_id, annonce_id, annonce_version").in("demand_id", demandIds);
  if (!withVersion.error) return (withVersion.data || []) as SendKey[];
  const plain = await supabase.from("client_demand_sends").select("demand_id, annonce_id").in("demand_id", demandIds);
  return (plain.data || []) as SendKey[];
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const [{ data: demandRows }, { data: annonceRows }] = await Promise.all([
    supabase.from("client_demands").select("*").eq("user_id", user.id).eq("is_active", true),
    supabase
      .from("annonces")
      .select("*")
      .eq("user_id", user.id)
      .eq("ai_is_real_estate", true)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(RECENT_ANNONCES),
  ]);

  const demands = (demandRows || []) as unknown as ClientDemand[];
  const annonces = (annonceRows || []) as unknown as Annonce[];
  const sends = await loadSends(supabase, demands.map((d) => d.id));

  const items = pendingReviews(demands, annonces, sends).map(({ demand, annonce, score, doubts }) => ({
    demandId: demand.id,
    clientName: demand.client_name,
    clientPhone: demand.client_phone,
    annonceId: annonce.id,
    score,
    doubts,
    typeOffre: annonce.type_offre,
    typeBien: annonce.type_bien,
    prix: annonce.prix,
    devise: annonce.devise,
    quartier: annonce.quartier,
    ville: annonce.ville,
    chambres: annonce.nb_chambres,
    resume: annonce.ai_summary,
    texte: (annonce.raw_text || "").slice(0, 600),
    image: Array.isArray(annonce.raw_images) ? (annonce.raw_images[0] ?? null) : null,
    postUrl: annonce.fb_post_url,
    createdAt: annonce.created_at,
  }));

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  const { demandId, annonceId, action } = parsed.data;

  // Le client et l'annonce doivent appartenir à l'agent connecté.
  const [{ data: demandRow }, { data: annonceRow }] = await Promise.all([
    supabase.from("client_demands").select("*").eq("id", demandId).eq("user_id", user.id).maybeSingle(),
    supabase.from("annonces").select("*").eq("id", annonceId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!demandRow || !annonceRow) return NextResponse.json({ error: "Client ou annonce introuvable" }, { status: 404 });

  const demand = demandRow as unknown as ClientDemand;
  const annonce = annonceRow as unknown as Annonce;
  const version = annonceVersion(annonce);

  const sends = await loadSends(supabase, [demandId]);
  if (sends.some((s) => s.annonce_id === annonceId && (s.annonce_version ?? 1) === version)) {
    return NextResponse.json({ error: "Cette annonce a déjà été traitée pour ce client." }, { status: 409 });
  }

  // WHY: l'agent n'a qu'un droit de lecture sur client_demand_sends (RLS). L'écriture passe
  // par la clé service, après le contrôle d'appartenance ci-dessus.
  const service = createServiceClient();
  const record = async (status: "sent" | "failed", messageId: string | null) => {
    const row = { demand_id: demandId, annonce_id: annonceId, message_id: messageId, status };
    if (version === 1) return service.from("client_demand_sends").insert(row);
    const versioned = await service.from("client_demand_sends").insert({ ...row, annonce_version: version });
    return versioned.error ? service.from("client_demand_sends").insert(row) : versioned;
  };

  if (action === "dismiss") {
    // HACK: pas de statut « écarté » dans la table. Une ligne « failed » marquée REVIEW_DISMISSED
    // n'est jamais affichée au client et empêche le cron de reproposer l'annonce.
    const { error } = await record("failed", REVIEW_DISMISSED);
    if (error) return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (!isWahaConfigured()) return NextResponse.json({ error: "WhatsApp non configuré" }, { status: 503 });

  let token = demand.access_token || null;
  if (!token) {
    token = generateAccessToken();
    const { error } = await service.from("client_demands").update({ access_token: token }).eq("id", demandId);
    if (error) return NextResponse.json({ error: "Envoi impossible : relancez supabase_schema.sql dans Supabase." }, { status: 500 });
  }

  // On envoie d'abord, on enregistre ensuite : un envoi raté ne marque rien comme reçu.
  const result = await sendWhatsAppMessage(
    demand.client_phone,
    formatClientLinkMessage({ name: demand.client_name, count: 1, link: clientLink(token) }),
    { image: await clientLinkImage() }
  );
  if (!result.success) return NextResponse.json({ error: "L'envoi WhatsApp a échoué. Réessayez." }, { status: 502 });

  const { error } = await record("sent", result.messageId || null);
  if (error) console.error("Review send record failed:", error.message);
  return NextResponse.json({ success: true });
}
