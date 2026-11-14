import { createServiceClient } from "@/lib/supabase/server";
import { checkDevice, DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, generateDeviceId, hashDevice, isValidToken } from "@/lib/client-access";
import { DEFAULT_RADIUS_KM, locateAnnonce, locatePlace } from "@/lib/geo";
import { checkRateLimit, getClientIp } from "@/lib/request-limit";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

// Espace client : annonces envoyées à un abonné, accessibles par son lien personnel.
// Route PUBLIQUE protégée par le jeton du lien et par l'appareil qui l'a ouvert en premier.

export const dynamic = "force-dynamic";

const READ_LIMIT = 60; // requêtes par minute et par adresse IP
const WINDOW_MS = 60_000;
const MAX_ANNONCES = 200;

const ActionSchema = z.object({
  annonceId: z.string().uuid(),
  action: z.enum(["keep", "remove", "reset"]),
});

const STATUS_BY_ACTION = { keep: "kept", remove: "removed", reset: "new" } as const;

type Row = Record<string, unknown>;

async function loadDemand(token: string) {
  const supabase = createServiceClient();
  const { data } = await supabase.from("client_demands").select("*").eq("access_token", token).maybeSingle();
  return { supabase, demand: data as Row | null };
}

function digits(value: unknown): string | null {
  const d = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return d.length >= 8 ? d : null;
}

/** Vérifie le jeton et l'appareil. Renvoie la demande, ou la réponse d'erreur à retourner. */
async function authorize(request: Request, token: string) {
  if (!isValidToken(token)) return { error: NextResponse.json({ error: "Lien invalide" }, { status: 404 }) };

  const limit = checkRateLimit(`client:${getClientIp(request)}`, READ_LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return { error: NextResponse.json({ error: "Trop de requêtes" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }) };
  }

  const { supabase, demand } = await loadDemand(token);
  if (!demand) return { error: NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 404 }) };

  const deviceId = cookies().get(DEVICE_COOKIE)?.value ?? null;
  const check = checkDevice(demand.device_hash as string | null, deviceId);
  if (check === "other_device") {
    return { error: NextResponse.json({ error: "Ce lien est déjà utilisé sur un autre appareil.", code: "other_device" }, { status: 403 }) };
  }

  let newDeviceId: string | null = null;
  if (check === "bind") {
    newDeviceId = deviceId || generateDeviceId();
    await supabase.from("client_demands").update({ device_hash: hashDevice(newDeviceId) }).eq("id", demand.id as string);
  }
  return { supabase, demand, newDeviceId };
}

function withDeviceCookie(response: NextResponse, deviceId: string | null) {
  if (deviceId) {
    response.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: DEVICE_COOKIE_MAX_AGE,
      path: "/",
    });
  }
  return response;
}

export async function GET(request: Request, { params }: { params: { token: string } }) {
  const auth = await authorize(request, params.token);
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
    const point = locateAnnonce(annonce as Parameters<typeof locateAnnonce>[0]);
    items.push({
      id: annonce.id,
      status: (send.client_status as string) || "new",
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
      postUrl: annonce.fb_post_url,
      source: String(annonce.fb_post_id || "").startsWith("tiktok_") ? "tiktok" : "facebook",
      telephone: digits(annonce.telephone),
      whatsapp: digits(annonce.whatsapp),
      publishedAt: annonce.fb_posted_at,
      geo: point && point.precision !== "ville" ? { lat: point.lat, lon: point.lon, lieu: point.lieu } : null,
    });
  }

  const radiusKm = demand.geo_radius_km && Number(demand.geo_radius_km) > 0 ? Number(demand.geo_radius_km) : DEFAULT_RADIUS_KM;
  const zones: { lat: number; lon: number; radiusKm: number; label: string }[] = [];
  if (typeof demand.geo_lat === "number" && typeof demand.geo_lon === "number") {
    zones.push({ lat: demand.geo_lat, lon: demand.geo_lon, radiusKm, label: "Votre secteur" });
  } else {
    for (const q of (demand.filter_quartiers as string[] | null) || []) {
      const p = locatePlace(q, ["quartier", "localite"]);
      if (p) zones.push({ lat: p.lat, lon: p.lon, radiusKm, label: p.lieu });
    }
  }

  return withDeviceCookie(
    NextResponse.json({
      clientName: demand.client_name,
      criteria: {
        typeOffre: demand.filter_type_offre || [],
        typeBien: demand.filter_type_bien || [],
        prixMin: demand.filter_prix_min,
        prixMax: demand.filter_prix_max,
        chambresMin: demand.filter_nb_chambres_min,
        quartiers: demand.filter_quartiers || [],
      },
      zones,
      annonces: items,
    }),
    newDeviceId
  );
}

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const auth = await authorize(request, params.token);
  if (auth.error) return auth.error;
  const { supabase, demand, newDeviceId } = auth;

  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide" }, { status: 400 });

  const { error } = await supabase
    .from("client_demand_sends")
    .update({ client_status: STATUS_BY_ACTION[parsed.data.action], decided_at: new Date().toISOString() })
    .eq("demand_id", demand.id as string)
    .eq("annonce_id", parsed.data.annonceId);

  if (error) {
    console.error("Client action failed:", error.message);
    return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
  }
  return withDeviceCookie(NextResponse.json({ success: true, status: STATUS_BY_ACTION[parsed.data.action] }), newDeviceId);
}
