import { authorizeClient, withDeviceCookie } from "@/lib/client-auth";
import { checkRateLimit } from "@/lib/request-limit";
import { currentOrderReference } from "@/lib/payment-reference";
import { findPlan, PLAN_IDS } from "@/lib/subscription";
import { NextResponse } from "next/server";
import { z } from "zod";

// Le client déclare avoir payé son abonnement (référence de la transaction Mobile Money).
// Rien n'est activé ici : l'agent vérifie le paiement puis valide depuis l'écran Clients.

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
  return withDeviceCookie(NextResponse.json({ success: true }), newDeviceId);
}
