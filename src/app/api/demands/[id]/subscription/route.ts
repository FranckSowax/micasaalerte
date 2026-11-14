import { createClient } from "@/lib/supabase/server";
import { clientLink, generateAccessToken } from "@/lib/client-access";
import { extendPaidUntil, formatDeadline, SUBSCRIPTION_DAYS, SUBSCRIPTION_PRICE_FCFA } from "@/lib/subscription";
import { formatSubscriptionActivatedMessage, sendWhatsAppMessage } from "@/lib/whatsapp";
import { NextResponse } from "next/server";
import { z } from "zod";

// Validation d'un abonnement par l'agent, depuis l'écran Clients :
// - activate : le paiement est reçu, le client gagne 2 jours et en est prévenu sur WhatsApp ;
// - reject   : la déclaration de paiement en attente est écartée.

const ActionSchema = z.object({ action: z.enum(["activate", "reject"]) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
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

  const paidUntil = extendPaidUntil(demand, now);
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
      amount: SUBSCRIPTION_PRICE_FCFA,
      days: SUBSCRIPTION_DAYS,
      reference: "Validation manuelle",
      status: "confirmed",
      confirmed_at: now.toISOString(),
    });
  }

  const sent = await sendWhatsAppMessage(
    demand.client_phone as string,
    formatSubscriptionActivatedMessage({
      name: demand.client_name as string | null,
      until: formatDeadline(paidUntil),
      link: clientLink(token),
    })
  );
  if (!sent.success) console.error("Activation WhatsApp send failed:", sent.error);

  return NextResponse.json({ success: true, paidUntil, notified: sent.success });
}
