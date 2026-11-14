import { createServiceClient } from "@/lib/supabase/server";
import { handleIncomingMessage } from "@/lib/chatbot";
import { safeEqual } from "@/lib/cron-auth";
import { getWahaSession, wahaFetch } from "@/lib/whatsapp";
import { NextResponse } from "next/server";
import { createHmac } from "crypto";

// Webhook entrant WAHA : messages WhatsApp reçus → chatbot.
// À déclarer côté WAHA avec l'événement `message` et une clé HMAC :
//   WHATSAPP_HOOK_URL=https://<app>/api/webhook/waha
//   WHATSAPP_HOOK_EVENTS=message
//   WHATSAPP_HOOK_HMAC_KEY=<même valeur que WAHA_WEBHOOK_HMAC_KEY ici>

export const dynamic = "force-dynamic";

// WAHA renvoie un événement tant qu'il n'a pas reçu de 200 : on mémorise les
// identifiants déjà traités pour ne pas répondre deux fois au même message.
const MAX_SEEN = 2_000;
const seenMessageIds = new Set<string>();

function alreadySeen(id: string): boolean {
  if (seenMessageIds.has(id)) return true;
  seenMessageIds.add(id);
  if (seenMessageIds.size > MAX_SEEN) {
    const oldest = seenMessageIds.values().next().value;
    if (oldest !== undefined) seenMessageIds.delete(oldest);
  }
  return false;
}

/**
 * Numéro de téléphone (chiffres seuls) de l'expéditeur.
 * WhatsApp masque parfois le numéro derrière un identifiant `@lid` :
 * on demande alors à WAHA la correspondance lid → numéro.
 */
async function resolvePhone(session: string, from: string): Promise<string | null> {
  if (from.endsWith("@c.us") || from.endsWith("@s.whatsapp.net")) {
    return from.split("@")[0].replace(/\D/g, "") || null;
  }

  if (from.endsWith("@lid")) {
    try {
      const res = await wahaFetch(
        `/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(from)}`
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { pn?: string | null };
      return data.pn ? data.pn.split("@")[0].replace(/\D/g, "") || null : null;
    } catch {
      return null;
    }
  }

  // Groupes (@g.us), chaînes (@newsletter), statuts (@broadcast) : ignorés.
  return null;
}

/**
 * Compte propriétaire de la session WAHA : WAHA_OWNER_USER_ID si défini,
 * sinon l'unique profil de la base (installation mono-compte).
 */
async function resolveOwnerId(): Promise<string | null> {
  const supabase = createServiceClient();

  const configured = process.env.WAHA_OWNER_USER_ID;
  if (configured) {
    const { data } = await supabase.from("profiles").select("id").eq("id", configured).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }

  const { data } = await supabase.from("profiles").select("id").limit(2);
  return data?.length === 1 ? (data[0].id as string) : null;
}

export async function POST(request: Request) {
  // La signature HMAC est obligatoire : sans elle, n'importe qui pourrait
  // injecter de faux messages clients et faire répondre le chatbot.
  const hmacKey = process.env.WAHA_WEBHOOK_HMAC_KEY;
  if (!hmacKey) {
    console.error("WAHA_WEBHOOK_HMAC_KEY non configuré : webhook refusé");
    return NextResponse.json({ error: "Webhook non configuré" }, { status: 503 });
  }

  const signature = request.headers.get("x-webhook-hmac");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // WAHA signe le corps brut en SHA-512 : on le lit en texte avant de le parser.
  const body = await request.text();
  const expected = createHmac("sha512", hmacKey).update(body).digest("hex");
  if (!safeEqual(signature.toLowerCase(), expected)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Tout ce qui suit répond 200 : un événement ignoré ne doit pas être renvoyé par WAHA.
  if (event.event !== "message") return new Response("OK");
  if (event.session !== getWahaSession()) return new Response("OK");

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const from = typeof payload.from === "string" ? payload.from : "";
  const text = typeof payload.body === "string" ? payload.body.trim() : "";
  const messageId = typeof payload.id === "string" ? payload.id : "";

  if (payload.fromMe === true || !from || !text) return new Response("OK");
  if (messageId && alreadySeen(messageId)) return new Response("OK");

  try {
    const phone = await resolvePhone(getWahaSession(), from);
    if (!phone) return new Response("OK");

    const ownerId = await resolveOwnerId();
    if (!ownerId) {
      console.error("Webhook WAHA : compte propriétaire introuvable (définir WAHA_OWNER_USER_ID)");
      return new Response("OK");
    }

    // On répond à l'identifiant d'origine (`from`), qui peut être un @lid.
    await handleIncomingMessage(ownerId, phone, text, from);
  } catch (error) {
    console.error("Webhook WAHA processing error:", error);
  }

  return new Response("OK");
}
