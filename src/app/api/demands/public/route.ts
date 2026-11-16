import { createServiceClient } from "@/lib/supabase/server";
import { fetchAllowedAgentIds } from "@/lib/agent-access";
import { checkRateLimit, getClientIp } from "@/lib/request-limit";
import { BUDGET_ISSUE, budgetIsCoherent, CRITERIA_FIELD_MESSAGES, criteriaShape, criteriaToRow } from "@/lib/demand-schema";
import { clientLink, generateAccessToken } from "@/lib/client-access";
import { checkCode, normalizePhone, OTP_COOKIE, OTP_MAX_ATTEMPTS, OTP_TTL_MS, readChallenge } from "@/lib/login-otp";
import { otpSecret } from "@/lib/login-otp-server";
import { pickForDemand, recordSelection } from "@/lib/selection";
import { formatClientLinkMessage, isWahaConfigured, sendWhatsAppMessage } from "@/lib/whatsapp";
import type { ClientDemand } from "@/types/database";
import { cookies } from "next/headers";
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
    // Facultatif : l'alerte fonctionne sans prénom.
    client_name: z.string().trim().max(80).nullish(),
    // Stocké en chiffres seuls (sans "+") : c'est le format du champ `from` envoyé
    // par WhatsApp, donc le chatbot retrouve la demande créée par le formulaire.
    client_phone: z
      .string()
      .transform((v) => normalizePhone(v))
      .pipe(z.string().regex(/^\d{8,15}$/)),
    // Code reçu sur WhatsApp : prouve que le numéro appartient bien à la personne qui s'inscrit.
    code: z.string().trim().regex(/^\d{6}$/),
    ...criteriaShape,
  })
  .refine(budgetIsCoherent, BUDGET_ISSUE);

const FIELD_MESSAGES: Record<string, string> = {
  userId: "Lien invalide",
  client_name: "Prénom trop long (80 caractères maximum)",
  client_phone: "Numéro WhatsApp invalide. Format : +24177123456",
  code: "Le code comporte 6 chiffres.",
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

  // Le code doit avoir été envoyé à ce numéro précis (défi signé déposé par /api/auth/otp/request).
  const otpCookie = cookies().get(OTP_COOKIE)?.value;
  const challenge = readChallenge(otpCookie);
  const secret = otpSecret();
  if (!challenge || !secret) {
    return NextResponse.json({ error: "Code expiré. Demandez un nouveau code." }, { status: 400 });
  }
  if (!checkRateLimit(`otp:verify:${challenge.nonce}`, OTP_MAX_ATTEMPTS, OTP_TTL_MS).allowed) {
    cookies().delete(OTP_COOKIE);
    return NextResponse.json({ error: "Trop d'essais. Demandez un nouveau code." }, { status: 429 });
  }
  const check = checkCode(otpCookie, input.code, secret);
  if (!check.ok) {
    return NextResponse.json(
      { error: check.reason === "expired" ? "Code expiré. Demandez un nouveau code." : "Code incorrect." },
      { status: 401 }
    );
  }
  if (check.challenge.phone !== input.client_phone) {
    return NextResponse.json({ error: "Le numéro a changé. Demandez un nouveau code." }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Verify admin user exists
  const { data: admin } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", input.userId)
    .maybeSingle();

  // SECURITY: inscription seulement auprès d'un agent autorisé (voir lib/agent-access).
  if (!admin || !(await fetchAllowedAgentIds())?.has(input.userId)) {
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const { filters, zone } = criteriaToRow(input);

  // Numéro déjà inscrit : on ne réécrit pas ses critères depuis le formulaire public. L'abonné se
  // connecte (code WhatsApp) et les modifie dans son espace. L'essai gratuit ne redémarre donc jamais.
  const { data: existingRows } = await supabase
    .from("client_demands")
    .select("id")
    .in("client_phone", [input.client_phone, `+${input.client_phone}`])
    .limit(1);
  if (existingRows?.length) {
    return NextResponse.json(
      { error: "Ce numéro est déjà inscrit. Connectez-vous pour ouvrir votre espace.", code: "exists" },
      { status: 409 }
    );
  }

  // Upsert client demand
  const base = {
    user_id: input.userId,
    client_phone: input.client_phone,
    client_name: input.client_name || null,
    is_active: true,
    ...filters,
    source: "form",
    last_message_at: now,
  };
  const save = (row: Record<string, unknown>) =>
    supabase.from("client_demands").upsert(row, { onConflict: "user_id,client_phone" }).select("id").single();

  // Le numéro vient d'être prouvé par le code : le lien de l'espace peut être remis à l'écran.
  const token = generateAccessToken();

  let { data, error } = await save({ ...base, ...zone, access_token: token });
  let linkToken: string | null = token;
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

  // Première sélection tout de suite, annoncée par un message WhatsApp avec le lien de l'espace,
  // quelle que soit l'heure : l'abonné vient de s'inscrire, la plage silencieuse ne s'applique pas.
  // WHY: jamais bloquant — si la sélection ou l'envoi échoue, l'inscription reste acquise et le
  // passage horaire prendra le relais.
  let firstSelection = 0;
  if (linkToken) {
    try {
      const { data: fresh } = await supabase.from("client_demands").select("*").eq("id", data.id).maybeSingle();
      if (fresh) {
        const demand = fresh as unknown as ClientDemand;
        const picked = await pickForDemand(supabase, demand);
        const sent = isWahaConfigured()
          ? await sendWhatsAppMessage(
              demand.client_phone,
              formatClientLinkMessage({ name: demand.client_name, count: picked.length, link: clientLink(linkToken), welcome: true })
            )
          : { success: false as const, messageId: undefined };
        if (!sent.success) console.error("Signup WhatsApp message failed");
        firstSelection = await recordSelection(supabase, demand, picked, sent.success && sent.messageId ? sent.messageId : "signup");
      }
    } catch (err) {
      console.error("First selection failed:", err instanceof Error ? err.message : err);
    }
  }

  cookies().delete(OTP_COOKIE);
  return NextResponse.json({
    success: true,
    id: data.id,
    isNew: true,
    firstSelection,
    // Chemin relatif : le navigateur du client reste sur le domaine où il a rempli le formulaire.
    spacePath: linkToken ? `/c/${linkToken}` : null,
  });
}
