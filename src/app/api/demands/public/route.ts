import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/request-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

// Route PUBLIQUE (formulaire /demande/[userId]) qui écrit avec la clé service :
// tout ce qui entre est validé et limité en débit avant de toucher la base.

const TYPE_OFFRE = ["location", "vente", "colocation"] as const;
const TYPE_BIEN = ["appartement", "maison", "studio", "villa", "chambre", "terrain"] as const;

const MAX_BODY_BYTES = 10_000;
const MAX_PRIX = 100_000_000_000; // 100 milliards FCFA

// Par adresse IP : un particulier remplit le formulaire une ou deux fois.
const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60_000;
// Par compte destinataire : borne le volume qu'on peut injecter chez un même agent,
// même en changeant d'adresse IP.
const ACCOUNT_LIMIT = 60;
const ACCOUNT_WINDOW_MS = 60 * 60_000;

const prix = z.number().int().min(0).max(MAX_PRIX).nullish();

const DemandSchema = z
  .object({
    userId: z.string().uuid(),
    client_name: z.string().trim().min(2).max(80),
    // Stocké en chiffres seuls (sans "+") : c'est le format du champ `from` envoyé
    // par WhatsApp, donc le chatbot retrouve la demande créée par le formulaire.
    client_phone: z
      .string()
      .transform((v) => v.replace(/[\s.\-()+]/g, ""))
      .pipe(z.string().regex(/^\d{8,15}$/)),
    filter_type_offre: z.array(z.enum(TYPE_OFFRE)).max(TYPE_OFFRE.length).default([]),
    filter_type_bien: z.array(z.enum(TYPE_BIEN)).max(TYPE_BIEN.length).default([]),
    filter_prix_min: prix,
    filter_prix_max: prix,
    filter_nb_chambres_min: z.number().int().min(0).max(20).nullish(),
    filter_quartiers: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
    // Secteur choisi sur la carte : un point au Gabon et un rayon de 1 à 5 km.
    geo_lat: z.number().min(-4.1).max(2.5).nullish(),
    geo_lon: z.number().min(8.5).max(14.7).nullish(),
    geo_radius_km: z.number().min(1).max(5).nullish(),
    filter_ville: z.string().trim().min(1).max(60).nullish(),
    exigences: z.string().trim().max(500).nullish(),
  })
  .refine(
    (d) => !d.filter_prix_min || !d.filter_prix_max || d.filter_prix_min <= d.filter_prix_max,
    { path: ["filter_prix_max"], message: "budget" }
  );

const FIELD_MESSAGES: Record<string, string> = {
  userId: "Lien invalide",
  client_name: "Nom invalide (2 à 80 caractères)",
  client_phone: "Numéro WhatsApp invalide. Format : +24177123456",
  filter_prix_min: "Budget invalide",
  filter_prix_max: "Budget invalide : le minimum dépasse le maximum",
  filter_nb_chambres_min: "Nombre de chambres invalide",
  filter_quartiers: "Secteur trop étendu",
  geo_lat: "Secteur invalide",
  geo_lon: "Secteur invalide",
  geo_radius_km: "Distance invalide (1 à 5 km)",
  exigences: "Exigences trop longues (500 caractères maximum)",
};

function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Trop de demandes. Réessayez dans quelques minutes." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(request: Request) {
  const ipCheck = checkRateLimit(`demand:ip:${getClientIp(request)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterSeconds);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Demande trop volumineuse" }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const parsed = DemandSchema.safeParse(json);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return NextResponse.json(
      { error: FIELD_MESSAGES[field] || "Formulaire invalide" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const accountCheck = checkRateLimit(
    `demand:account:${input.userId}`,
    ACCOUNT_LIMIT,
    ACCOUNT_WINDOW_MS
  );
  if (!accountCheck.allowed) return tooManyRequests(accountCheck.retryAfterSeconds);

  const supabase = createServiceClient();

  // Verify admin user exists
  const { data: admin } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", input.userId)
    .maybeSingle();

  if (!admin) {
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 });
  }

  const now = new Date().toISOString();

  const hasZone = typeof input.geo_lat === "number" && typeof input.geo_lon === "number";
  const zone = {
    geo_lat: hasZone ? input.geo_lat : null,
    geo_lon: hasZone ? input.geo_lon : null,
    geo_radius_km: hasZone ? (input.geo_radius_km ?? 1) : null,
  };

  // Upsert client demand
  const base = {
    user_id: input.userId,
    client_phone: input.client_phone,
    client_name: input.client_name,
    is_active: true,
    filter_type_offre: input.filter_type_offre,
    filter_type_bien: input.filter_type_bien,
    filter_prix_min: input.filter_prix_min || null,
    filter_prix_max: input.filter_prix_max || null,
    filter_nb_chambres_min: input.filter_nb_chambres_min || null,
    filter_quartiers: input.filter_quartiers,
    // Avec un secteur choisi sur la carte, la ville ne doit pas bloquer : Angondjé relève
    // d'Akanda, pas de Libreville. Le secteur fait foi.
    filter_ville: hasZone ? null : input.filter_ville || "Libreville",
    exigences: input.exigences || null,
    source: "form",
    last_message_at: now,
  };
  const save = (row: Record<string, unknown>) =>
    supabase.from("client_demands").upsert(row, { onConflict: "user_id,client_phone" }).select("id").single();

  let { data, error } = await save({ ...base, ...zone });
  // Base sans les colonnes de secteur (migration non exécutée) : on enregistre sans elles.
  if (error) ({ data, error } = await save(base));

  if (error || !data) {
    // Le détail reste dans les logs serveur : le message Postgres ne sort pas vers le public.
    console.error("Public demand upsert failed:", error?.message);
    return NextResponse.json(
      { error: "Enregistrement impossible. Réessayez plus tard." },
      { status: 500 }
    );
  }

  // Also create/update chatbot conversation as active
  const { error: convError } = await supabase.from("chatbot_conversations").upsert(
    {
      user_id: input.userId,
      client_phone: input.client_phone,
      conversation_state: "active",
      context: {},
      last_interaction_at: now,
    },
    { onConflict: "user_id,client_phone" }
  );
  if (convError) console.error("Chatbot conversation upsert failed:", convError.message);

  return NextResponse.json({ success: true, id: data.id });
}
