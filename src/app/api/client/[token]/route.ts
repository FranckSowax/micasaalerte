import { authorizeClient, withDeviceCookie } from "@/lib/client-auth";
import { CRITERIA_FIELD_MESSAGES, CriteriaSchema, criteriaToRow } from "@/lib/demand-schema";
import { DEFAULT_RADIUS_KM, locateAnnonce, locatePlace } from "@/lib/geo";
import { matchDemand } from "@/lib/matching";
import { MAX_PER_ANNONCE } from "@/lib/photos";
import { activeReports, isReport, mainReason, shouldAutoWithdraw, withdrawalOf, withWithdrawal, type FeedbackRow } from "@/lib/reports";
import { doubtLabels } from "@/lib/review";
import { pickForDemand, recordSelection } from "@/lib/selection";
import type { Annonce, ClientDemand } from "@/types/database";
import { paymentInfo, subscriptionState, SUBSCRIPTION_DAYS, SUBSCRIPTION_PLANS, SUBSCRIPTION_PRICE_FCFA, TRIAL_HOURS } from "@/lib/subscription";
import type { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

// Espace client : annonces envoyées à un abonné, accessibles par son lien personnel.
// Route PUBLIQUE protégée par le jeton du lien et par l'appareil qui l'a ouvert en premier.
// GET : annonces, critères et état de l'abonnement ; POST : tri d'une annonce ;
// PATCH : modification des critères de recherche par le client.

export const dynamic = "force-dynamic";

const MAX_ANNONCES = 200;

/** Avis de l'abonné sur une annonce : pertinente, ou la raison pour laquelle elle ne l'est pas. */
const FEEDBACK = ["pertinente", "prix", "quartier", "type", "equipement", "indisponible", "arnaque"] as const;

const ActionSchema = z.object({
  annonceId: z.string().uuid(),
  action: z.enum(["keep", "remove", "reset"]),
  feedback: z.enum(FEEDBACK).optional(),
});

const STATUS_BY_ACTION = { keep: "kept", remove: "removed", reset: "new" } as const;

type Row = Record<string, unknown>;

function digits(value: unknown): string | null {
  const d = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return d.length >= 8 ? d : null;
}

export async function GET(request: Request, { params }: { params: { token: string } }) {
  const auth = await authorizeClient(request, params.token);
  if (auth.error) return auth.error;
  const { supabase, demand, newDeviceId } = auth;

  const { data: sends } = await supabase
    .from("client_demand_sends")
    .select("*")
    .eq("demand_id", demand.id as string)
    .order("sent_at", { ascending: false })
    .limit(MAX_ANNONCES);

  const sendRows = ((sends || []) as Row[]).filter((s) => s.status !== "failed");
  const ids = Array.from(new Set(sendRows.map((s) => s.annonce_id as string)));
  const { data: annonces } = ids.length ? await supabase.from("annonces").select("*").in("id", ids) : { data: [] as Row[] };
  const byId = new Map(((annonces || []) as Row[]).map((a) => [a.id as string, a]));

  const seen = new Set<string>();
  const items = [];
  for (const send of sendRows) {
    const annonce = byId.get(send.annonce_id as string);
    // Une annonce renvoyée après un changement de prix n'apparaît qu'une fois, à sa version la plus récente.
    if (!annonce || seen.has(annonce.id as string)) continue;
    seen.add(annonce.id as string);
    const match = matchDemand(annonce as unknown as Annonce, demand as unknown as ClientDemand);
    const clientStatus = (send.client_status as string) || "new";
    // Critères modifiés : une annonce encore « à trier » qui ne correspond plus n'est plus proposée.
    // Celles que l'abonné a retenues ou supprimées restent visibles : c'est son propre tri.
    if (clientStatus === "new" && !match.eligible) continue;
    // Annonce retirée (signalée par des abonnés, validée par l'agent ou par le seuil) : elle
    // n'est plus proposée. Si l'abonné l'avait déjà classée, il la garde avec la mention du retrait.
    const withdrawal = annonce.status === "archived" ? withdrawalOf(annonce.details as Record<string, unknown> | null) : null;
    if (clientStatus === "new" && annonce.status === "archived") continue;
    const point = locateAnnonce(annonce as Parameters<typeof locateAnnonce>[0]);
    items.push({
      id: annonce.id,
      status: clientStatus,
      feedback: (send.client_feedback as string | null | undefined) ?? null,
      withdrawn: withdrawal ? (withdrawal.reason === "arnaque" ? "Annonce retirée : signalée comme arnaque" : "Annonce retirée : bien déjà loué ou vendu") : null,
      // Informations manquantes à vérifier auprès de l'annonceur (onglet « À vérifier »),
      // recalculées avec les critères actuels de l'abonné.
      doubts: doubtLabels(match.decisiveDoubts),
      sentAt: send.sent_at,
      typeOffre: annonce.type_offre,
      typeBien: annonce.type_bien,
      prix: annonce.prix,
      devise: annonce.devise,
      quartier: annonce.quartier,
      ville: annonce.ville,
      chambres: annonce.nb_chambres,
      meuble: annonce.meuble,
      resume: annonce.ai_summary,
      image: Array.isArray(annonce.raw_images) ? (annonce.raw_images[0] ?? null) : null,
      // Toutes les photos collectées (6 au plus), pour la galerie.
      images: Array.isArray(annonce.raw_images)
        ? (annonce.raw_images as unknown[]).filter((u): u is string => typeof u === "string" && u.startsWith("https://")).slice(0, MAX_PER_ANNONCE)
        : [],
      postUrl: annonce.fb_post_url,
      source: String(annonce.fb_post_id || "").startsWith("tiktok_") ? "tiktok" : "facebook",
      telephone: digits(annonce.telephone),
      whatsapp: digits(annonce.whatsapp),
      publishedAt: annonce.fb_posted_at,
      geo: point && point.precision !== "ville" ? { lat: point.lat, lon: point.lon, lieu: point.lieu } : null,
    });
  }

  const hasPoint = typeof demand.geo_lat === "number" && typeof demand.geo_lon === "number";
  const radiusKm = demand.geo_radius_km && Number(demand.geo_radius_km) > 0 ? Number(demand.geo_radius_km) : DEFAULT_RADIUS_KM;
  const zones: { lat: number; lon: number; radiusKm: number; label: string }[] = [];
  if (hasPoint) {
    zones.push({ lat: demand.geo_lat as number, lon: demand.geo_lon as number, radiusKm, label: "Votre secteur" });
  } else {
    for (const q of (demand.filter_quartiers as string[] | null) || []) {
      const p = locatePlace(q, ["quartier", "localite"]);
      if (p) zones.push({ lat: p.lat, lon: p.lon, radiusKm, label: p.lieu });
    }
  }

  // Table absente (migration non exécutée) : la requête échoue et on n'affiche rien en attente.
  const { data: pending } = await supabase
    .from("subscription_payments")
    .select("id")
    .eq("demand_id", demand.id as string)
    .eq("status", "pending")
    .limit(1);

  const state = subscriptionState(demand as Parameters<typeof subscriptionState>[0]);

  return withDeviceCookie(
    NextResponse.json({
      clientName: demand.client_name,
      subscription: {
        status: state.status,
        endsAt: state.endsAt,
        price: SUBSCRIPTION_PRICE_FCFA,
        days: SUBSCRIPTION_DAYS,
        plans: SUBSCRIPTION_PLANS,
        trialHours: TRIAL_HOURS,
        paymentInfo: paymentInfo(),
        pendingPayment: !!pending?.length,
      },
      criteria: {
        typeOffre: demand.filter_type_offre || [],
        typeBien: demand.filter_type_bien || [],
        prixMin: demand.filter_prix_min,
        prixMax: demand.filter_prix_max,
        chambresMin: demand.filter_nb_chambres_min,
        quartiers: demand.filter_quartiers || [],
        exigences: demand.exigences || "",
        geoLat: hasPoint ? demand.geo_lat : null,
        geoLon: hasPoint ? demand.geo_lon : null,
        // Le rayon vaut aussi autour de chaque quartier choisi par son nom.
        radiusKm: demand.geo_radius_km && Number(demand.geo_radius_km) > 0 ? radiusKm : null,
      },
      zones,
      annonces: items,
    }),
    newDeviceId
  );
}

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const auth = await authorizeClient(request, params.token);
  if (auth.error) return auth.error;
  const { supabase, demand, newDeviceId } = auth;

  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide" }, { status: 400 });

  const decision = { client_status: STATUS_BY_ACTION[parsed.data.action], decided_at: new Date().toISOString() };
  // « Remettre à trier » efface l'avis ; sinon on enregistre celui qui accompagne la décision.
  const feedback = parsed.data.action === "reset" ? null : (parsed.data.feedback ?? null);
  const save = (row: Record<string, unknown>) =>
    supabase.from("client_demand_sends").update(row).eq("demand_id", demand.id as string).eq("annonce_id", parsed.data.annonceId);

  let { error } = await save({ ...decision, client_feedback: feedback });
  // Colonne client_feedback absente (script SQL pas encore relancé) : la décision est enregistrée sans l'avis.
  if (error) ({ error } = await save(decision));

  if (error) {
    console.error("Client action failed:", error.message);
    return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
  }
  // Deux abonnés différents signalent la même annonce : elle est retirée chez tous, sans attendre l'agent.
  if (isReport(feedback)) await autoWithdraw(supabase, parsed.data.annonceId);

  return withDeviceCookie(NextResponse.json({ success: true, status: STATUS_BY_ACTION[parsed.data.action] }), newDeviceId);
}

/** Retire l'annonce (statut « archived ») si le seuil de signalements est atteint. Sans effet sinon. */
async function autoWithdraw(supabase: ReturnType<typeof createServiceClient>, annonceId: string): Promise<void> {
  const [{ data: annonce }, { data: rows, error }] = await Promise.all([
    supabase.from("annonces").select("id, status, details").eq("id", annonceId).maybeSingle(),
    supabase.from("client_demand_sends").select("demand_id, annonce_id, client_feedback, decided_at").eq("annonce_id", annonceId).not("client_feedback", "is", null),
  ]);
  // Colonne client_feedback absente ou annonce introuvable : rien à faire.
  if (error || !annonce || !rows) return;
  const details = annonce.details as Record<string, unknown> | null;
  const reports = rows as unknown as FeedbackRow[];
  if (!shouldAutoWithdraw(reports, details)) return;

  const { error: updateError } = await supabase
    .from("annonces")
    .update({ status: "archived", details: withWithdrawal(details, mainReason(activeReports(reports, details)), "auto") })
    .eq("id", annonceId);
  if (updateError) console.error("Auto withdraw failed:", updateError.message);
}

export async function PATCH(request: Request, { params }: { params: { token: string } }) {
  const auth = await authorizeClient(request, params.token);
  if (auth.error) return auth.error;
  const { supabase, demand, newDeviceId } = auth;

  const parsed = CriteriaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return NextResponse.json({ error: CRITERIA_FIELD_MESSAGES[field] || "Critères invalides" }, { status: 400 });
  }

  // Les annonces retenues ou supprimées restent en place. Celles « à trier » qui ne correspondent
  // plus disparaissent de la liste (voir GET), et une nouvelle sélection est proposée tout de suite.
  const { filters, zone } = criteriaToRow(parsed.data);
  const { error } = await supabase
    .from("client_demands")
    .update({ ...filters, ...zone, last_message_at: new Date().toISOString() })
    .eq("id", demand.id as string);

  if (error) {
    console.error("Client criteria update failed:", error.message);
    return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
  }

  // Nouvelle sélection tout de suite, sans message WhatsApp : l'abonné est déjà sur la page.
  const updated = { ...demand, ...filters, ...zone } as unknown as ClientDemand;
  const added = await recordSelection(supabase, updated, await pickForDemand(supabase, updated), "criteria_refresh");
  return withDeviceCookie(NextResponse.json({ success: true, added }), newDeviceId);
}

