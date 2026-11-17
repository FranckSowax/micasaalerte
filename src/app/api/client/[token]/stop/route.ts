import { NextResponse } from "next/server";
import { authorizeClient, withDeviceCookie } from "@/lib/client-auth";

// « Arrêter les envois » (espace abonné) : plus de nouvelles annonces ni de messages WhatsApp.
// Même effet que « Désactiver » dans la page Clients : seul l'agent peut réactiver l'abonné.
// L'espace reste ouvert : l'abonné garde ses annonces déjà reçues.

export const dynamic = "force-dynamic";

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const auth = await authorizeClient(request, params.token);
  if (auth.error) return auth.error;
  const { supabase, demand, newDeviceId } = auth;

  const { error } = await supabase.from("client_demands").update({ is_active: false }).eq("id", demand.id as string);
  if (error) {
    console.error("Client stop failed:", error.message);
    return NextResponse.json({ error: "Impossible d'arrêter les envois pour le moment. Réessayez." }, { status: 500 });
  }
  return withDeviceCookie(NextResponse.json({ success: true, sending: false }), newDeviceId);
}
