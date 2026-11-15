import { authorizeClient, withDeviceCookie } from "@/lib/client-auth";
import { checkRateLimit } from "@/lib/request-limit";
import { currentOrderReference } from "@/lib/payment-reference";
import { findPlan, PLAN_IDS } from "@/lib/subscription";
import { publicBaseUrl } from "@/lib/client-access";
import { formatPaymentDeclaredMessage, isWahaConfigured, sendWhatsAppMessage } from "@/lib/whatsapp";
import { NextResponse } from "next/server";
import { z } from "zod";

// L'abonné déclare avoir payé avec sa référence de commande. Rien n'est activé ici : l'agent est
// prévenu, vérifie l'encaissement dans Airtel Money puis valide depuis l'écran Paiements.

export const dynamic = "force-dynamic";

const PER_LINK = 5; // déclarations par heure et par abonné
const HOUR_MS = 60 * 60_000;

const PaymentSchema = z.object({
  // Formule choisie : 1 jour, 7 jours ou 30 jours. La référence n'est pas saisie par l'abonné :
  // c'est la référence de commande que l'application lui a donnée à entrer dans Airtel Money.
  plan: z.enum(PLAN_IDS).default("day"),
});

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const auth = await authorizeClient(request, params.token);
  if (auth.error) return auth.error;
  const { supabase, demand, newDeviceId } = auth;

  const limit = checkRateLimit(`payment:${demand.id}`, PER_LINK, HOUR_MS);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Trop de déclarations. Réessayez plus tard." }, { status: 429 });
  }

  const parsed = PaymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Formule invalide" }, { status: 400 });
  }

  const demandId = demand.id as string;
  // Même référence que celle affichée à l'abonné : elle est recalculée, jamais reçue du navigateur.
  const reference = await currentOrderReference(supabase, demandId);
  if (!reference) return NextResponse.json({ error: "Paiement indisponible pour le moment." }, { status: 503 });
  const { data: pending } = await supabase
    .from("subscription_payments")
    .select("id")
    .eq("demand_id", demandId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  const plan = findPlan(parsed.data.plan);

  // Une seule déclaration en attente par client : une nouvelle saisie corrige la référence et la formule.
  const { error } = pending
    ? await supabase
        .from("subscription_payments")
        .update({ reference, amount: plan.price, days: plan.days })
        .eq("id", pending.id)
    : await supabase.from("subscription_payments").insert({
        demand_id: demandId,
        user_id: demand.user_id as string,
        amount: plan.price,
        days: plan.days,
        reference,
        status: "pending",
      });

  if (error) {
    console.error("Payment declaration failed:", error.message);
    return NextResponse.json({ error: "Enregistrement impossible. Réessayez plus tard." }, { status: 500 });
  }

  // Nouvelle déclaration : l'agent est prévenu sur son WhatsApp (numéro de ses Paramètres) pour
  // vérifier l'encaissement. Une correction de formule sur une déclaration déjà signalée ne le relance pas.
  // WHY: jamais bloquant — la déclaration est enregistrée et visible dans l'écran Paiements quoi qu'il arrive.
  if (!pending && isWahaConfigured()) {
    try {
      const { data: agent } = await supabase.from("profiles").select("whatsapp_phone").eq("id", demand.user_id as string).maybeSingle();
      const agentPhone = (agent?.whatsapp_phone as string | null) || null;
      if (agentPhone) {
        const client = `${(demand.client_name as string | null) || "Un abonné"} (${demand.client_phone as string})`;
        await sendWhatsAppMessage(
          agentPhone,
          formatPaymentDeclaredMessage({ client, amount: plan.price, days: plan.days, reference, link: `${publicBaseUrl()}/paiements` })
        );
      }
    } catch (err) {
      console.error("Agent payment notice failed:", err instanceof Error ? err.message : err);
    }
  }

  return withDeviceCookie(NextResponse.json({ success: true }), newDeviceId);
}
