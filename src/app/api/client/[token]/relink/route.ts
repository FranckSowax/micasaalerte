import { createServiceClient } from "@/lib/supabase/server";
import { clientLink, generateAccessToken, isValidToken } from "@/lib/client-access";
import { checkRateLimit, getClientIp } from "@/lib/request-limit";
import { formatClientLinkMessage, sendWhatsAppMessage } from "@/lib/whatsapp";
import { NextResponse } from "next/server";

// Lien ouvert sur un autre appareil : on en envoie un NOUVEAU sur le numéro WhatsApp
// du titulaire. L'ancien lien cesse de fonctionner, où qu'il ait été transféré.

export const dynamic = "force-dynamic";

const PER_LINK = 3; // nouveaux liens par heure et par abonné : évite d'inonder son WhatsApp
const PER_IP = 6;
const HOUR_MS = 60 * 60_000;

// Réponse identique que le lien existe ou non : on ne révèle rien à qui teste des jetons.
const GENERIC = { success: true, message: "Si ce lien est valide, un nouveau lien vient d'être envoyé sur WhatsApp." };

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  if (!isValidToken(params.token)) return NextResponse.json(GENERIC);

  const ip = checkRateLimit(`relink:ip:${getClientIp(request)}`, PER_IP, HOUR_MS);
  const link = checkRateLimit(`relink:token:${params.token}`, PER_LINK, HOUR_MS);
  if (!ip.allowed || !link.allowed) {
    return NextResponse.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429 });
  }

  const supabase = createServiceClient();
  const { data: demand } = await supabase
    .from("client_demands")
    .select("id, client_phone, client_name, is_active")
    .eq("access_token", params.token)
    .maybeSingle();

  if (!demand?.client_phone) return NextResponse.json(GENERIC);

  const token = generateAccessToken();
  const { error } = await supabase.from("client_demands").update({ access_token: token, device_hash: null }).eq("id", demand.id);
  if (error) {
    console.error("Relink failed:", error.message);
    return NextResponse.json(GENERIC);
  }

  const result = await sendWhatsAppMessage(
    demand.client_phone as string,
    formatClientLinkMessage({ name: demand.client_name as string | null, link: clientLink(token), renewed: true })
  );
  if (!result.success) console.error("Relink WhatsApp send failed:", result.error);

  return NextResponse.json(GENERIC);
}
