import { authorizeClient } from "@/lib/client-auth";
import { DEVICE_COOKIE } from "@/lib/client-access";
import { NextResponse } from "next/server";

// Déconnexion de l'espace client : l'appareil n'est plus lié au lien personnel.
// L'abonné revient par son lien WhatsApp (premier appareil à l'ouvrir) ou par un code sur /login.

export const dynamic = "force-dynamic";

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const auth = await authorizeClient(request, params.token);
  if (auth.error) return auth.error;

  const { error } = await auth.supabase.from("client_demands").update({ device_hash: null }).eq("id", auth.demand.id as string);
  if (error) {
    console.error("Client logout failed:", error.message);
    return NextResponse.json({ error: "Déconnexion impossible. Réessayez." }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete(DEVICE_COOKIE);
  return response;
}
