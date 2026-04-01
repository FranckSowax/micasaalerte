import { createServiceClient } from "@/lib/supabase/server";
import { handleIncomingMessage } from "@/lib/chatbot";
import { NextResponse } from "next/server";
import { createHmac } from "crypto";

// GET: Webhook verification (Meta sends this when you configure the webhook)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

// POST: Incoming WhatsApp messages
export async function POST(request: Request) {
  // Validate signature
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const signature = request.headers.get("x-hub-signature-256");
    const body = await request.text();

    if (signature) {
      const expectedSig = "sha256=" + createHmac("sha256", appSecret).update(body).digest("hex");
      if (signature !== expectedSig) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    // Parse body from text since we already consumed it
    const payload = JSON.parse(body);
    await processWebhook(payload);
  } else {
    // No app secret configured, skip validation
    const payload = await request.json();
    await processWebhook(payload);
  }

  return new Response("OK", { status: 200 });
}

async function processWebhook(payload: Record<string, unknown>) {
  try {
    const entries = (payload.entry || []) as Record<string, unknown>[];

    for (const entry of entries) {
      const changes = (entry.changes || []) as Record<string, unknown>[];

      for (const change of changes) {
        const value = change.value as Record<string, unknown>;
        if (!value) continue;

        const metadata = value.metadata as Record<string, unknown>;
        const phoneNumberId = metadata?.phone_number_id as string;
        if (!phoneNumberId) continue;

        const messages = (value.messages || []) as Record<string, unknown>[];

        for (const message of messages) {
          // Only handle text messages
          if (message.type !== "text") continue;

          const from = message.from as string;
          const textBody = (message.text as Record<string, unknown>)?.body as string;

          if (!from || !textBody) continue;

          // Find admin user by phone_number_id
          const supabase = createServiceClient();
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, whatsapp_access_token")
            .eq("whatsapp_phone_number_id", phoneNumberId)
            .limit(1);

          if (!profiles?.length) {
            console.error(`No admin found for phone_number_id: ${phoneNumberId}`);
            continue;
          }

          const adminProfile = profiles[0];
          const accessToken = (adminProfile as Record<string, unknown>).whatsapp_access_token as string
            || process.env.WHATSAPP_ACCESS_TOKEN;

          if (!accessToken) {
            console.error(`No access token for admin: ${adminProfile.id}`);
            continue;
          }

          // Handle message
          await handleIncomingMessage(
            adminProfile.id as string,
            from,
            textBody,
            phoneNumberId,
            accessToken
          );
        }
      }
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
  }
}
