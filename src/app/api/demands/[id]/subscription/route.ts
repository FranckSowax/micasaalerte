import { createClient, createServiceClient } from "@/lib/supabase/server";
import { pickForDemand, recordSelection } from "@/lib/selection";
import type { Annonce, ClientDemand } from "@/types/database";
import { clientLink, generateAccessToken } from "@/lib/client-access";
import { extendPaidUntil, findPlan, formatDeadline, PLAN_IDS } from "@/lib/subscription";
import { formatSubscriptionActivatedMessage, sendWhatsAppMessage } from "@/lib/whatsapp";
import { NextResponse } from "next/server";
import { z } from "zod";

// Validation d'un abonnement par l'agent, depuis les écrans Paiements et Clients :
// - activate : le paiement est vérifié, l'abonnement démarre (jours de la formule) et l'abonné reçoit
//   sur WhatsApp la confirmation avec sa première sélection d'annonces ;
// - reject   : la déclaration de paiement en attente est écartée.

const ActionSchema = z.object({
  action: z.enum(["activate", "reject"]),
  // Formule accordée quand l'agent active sans déclaration du client.
  plan: z.enum(PLAN_IDS).default("day"),
});

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide" }, { status: 400 });

  const { data: demand } = await supabase
    .from("client_demands")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!demand) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  const now = new Date();

  if (parsed.data.action === "reject") {
    const { error } = await supabase
      .from("subscription_payments")
      .update({ status: "rejected", confirmed_at: now.toISOString() })
      .eq("demand_id", params.id)
      .eq("status", "pending");
    if (error) return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // Formule : celle déclarée par le client si un paiement est en attente, sinon celle choisie par l'agent.
  const plan = findPlan(parsed.data.plan);
  const { data: pending } = await supabase
    .from("subscription_payments")
    .select("days")
    .eq("demand_id", params.id)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  const days = typeof pending?.days === "number" && pending.days > 0 ? pending.days : plan.days;
  const paidUntil = extendPaidUntil(demand, now, days);
  const token = (demand.access_token as string | null) || generateAccessToken();

  const { error } = await supabase
    .from("client_demands")
    .update({ paid_until: paidUntil, expiry_notified_at: null, is_active: true, access_token: token })
    .eq("id", params.id)
    .eq("user_id", user.id);
  if (error) {
    // Colonnes d'abonnement absentes : la migration SQL n'a pas été exécutée.
    console.error("Subscription activation failed:", error.message);
    return NextResponse.json({ error: "Activation impossible : relancez supabase_schema.sql dans Supabase." }, { status: 500 });
  }

  // Trace du paiement : on confirme la déclaration en attente, sinon on en crée une.
  const { data: confirmed } = await supabase
    .from("subscription_payments")
    .update({ status: "confirmed", confirmed_at: now.toISOString() })
    .eq("demand_id", params.id)
    .eq("status", "pending")
    .select("id");
  if (!confirmed?.length) {
    await supabase.from("subscription_payments").insert({
      demand_id: params.id,
      user_id: user.id,
      amount: plan.price,
      days: plan.days,
      reference: "Validation manuelle",
      status: "confirmed",
      confirmed_at: now.toISOString(),
    });
  }

  // Premier message de l'abonnement : les annonces récentes qui correspondent sont ajoutées tout de
  // suite à l'espace et annoncées dans le message de validation, sans attendre le passage horaire.
  // WHY: clé service pour l'écriture — l'agent n'a qu'un droit de lecture sur client_demand_sends
  // (RLS). L'appartenance du client à l'agent a été vérifiée plus haut.
  const service = createServiceClient();
  const active = { ...demand, paid_until: paidUntil, expiry_notified_at: null, is_active: true, access_token: token } as unknown as ClientDemand;
  let picked: Annonce[] = [];
  try {
    picked = await pickForDemand(service, active, now);
  } catch (err) {
    console.error("Activation selection failed:", err instanceof Error ? err.message : err);
  }

  const sent = await sendWhatsAppMessage(
    demand.client_phone as string,
    formatSubscriptionActivatedMessage({
      name: demand.client_name as string | null,
      until: formatDeadline(paidUntil),
      link: clientLink(token),
      count: picked.length,
    })
  );
  if (!sent.success) console.error("Activation WhatsApp send failed:", sent.error);

  // Enregistrées même si le message a échoué : l'abonné les trouve dans son espace.
  const added = picked.length ? await recordSelection(service, active, picked, sent.success && sent.messageId ? sent.messageId : "activation") : 0;

  return NextResponse.json({ success: true, paidUntil, notified: sent.success, added });
}
