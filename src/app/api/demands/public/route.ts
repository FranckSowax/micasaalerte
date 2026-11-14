import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/request-limit";
import { BUDGET_ISSUE, budgetIsCoherent, CRITERIA_FIELD_MESSAGES, criteriaShape, criteriaToRow } from "@/lib/demand-schema";
import { generateAccessToken } from "@/lib/client-access";
import { NextResponse } from "next/server";
import { z } from "zod";

// Route PUBLIQUE (formulaire /demande/[userId]) qui écrit avec la clé service :
// tout ce qui entre est validé et limité en débit avant de toucher la base.

const MAX_BODY_BYTES = 10_000;

// Par adresse IP : un particulier remplit le formulaire une ou deux fois.
const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60_000;
// Par compte destinataire : borne le volume qu'on peut injecter chez un même agent,
// même en changeant d'adresse IP.
const ACCOUNT_LIMIT = 60;
const ACCOUNT_WINDOW_MS = 60 * 60_000;

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
    ...criteriaShape,
  })
  .refine(budgetIsCoherent, BUDGET_ISSUE);

const FIELD_MESSAGES: Record<string, string> = {
  userId: "Lien invalide",
  client_name: "Nom invalide (2 à 80 caractères)",
  client_phone: "Numéro WhatsApp invalide. Format : +24177123456",
  ...CRITERIA_FIELD_MESSAGES,
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
  const { filters, zone } = criteriaToRow(input);

  // Première inscription de ce numéro ? L'essai gratuit de 24 h démarre alors (valeur par
  // défaut de la colonne trial_ends_at) ; une réinscription ne le relance pas.
  const { data: existing } = await supabase
    .from("client_demands")
    .select("id")
    .eq("user_id", input.userId)
    .eq("client_phone", input.client_phone)
    .maybeSingle();

  // Upsert client demand
  const base = {
    user_id: input.userId,
    client_phone: input.client_phone,
    client_name: input.client_name,
    is_active: true,
    ...filters,
    source: "form",
    last_message_at: now,
  };
  const save = (row: Record<string, unknown>) =>
    supabase.from("client_demands").upsert(row, { onConflict: "user_id,client_phone" }).select("id").single();

  // WHY: le lien de l'espace personnel n'est remis à l'écran qu'à la toute première
  // inscription. Pour un numéro déjà inscrit, le lien ne part que sur son WhatsApp : sinon
  // n'importe qui ouvrirait l'espace d'un client en ressaisissant son numéro.
  const token = existing ? null : generateAccessToken();

  let { data, error } = await save({ ...base, ...zone, ...(token ? { access_token: token } : {}) });
  let linkToken = token;
  // Base sans les colonnes de secteur ou de lien (migration non exécutée) : on enregistre sans elles.
  if (error) {
    ({ data, error } = await save(base));
    linkToken = null;
  }

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

  return NextResponse.json({
    success: true,
    id: data.id,
    isNew: !existing,
    // Chemin relatif : le navigateur du client reste sur le domaine où il a rempli le formulaire.
    spacePath: linkToken ? `/c/${linkToken}` : null,
  });
}
