import { createClient } from "@/lib/supabase/server";
import { getWahaSession, isWahaConfigured, wahaFetch } from "@/lib/whatsapp";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// État de la connexion WhatsApp (session WAHA), affiché dans les Paramètres.
// Ne renvoie ni l'URL du serveur ni la clé d'API.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const session = getWahaSession();

  if (!isWahaConfigured()) {
    return NextResponse.json({ configured: false, session, status: "NOT_CONFIGURED" });
  }

  try {
    const res = await wahaFetch(`/api/sessions/${encodeURIComponent(session)}`);

    if (res.status === 404) {
      return NextResponse.json({ configured: true, session, status: "NO_SESSION" });
    }
    if (!res.ok) {
      return NextResponse.json({ configured: true, session, status: "ERROR", httpStatus: res.status });
    }

    const data = (await res.json()) as {
      status?: string;
      me?: { id?: string; pushName?: string } | null;
    };

    return NextResponse.json({
      configured: true,
      session,
      status: data.status || "UNKNOWN",
      phone: data.me?.id ? data.me.id.split("@")[0] : null,
      name: data.me?.pushName || null,
    });
  } catch {
    return NextResponse.json({ configured: true, session, status: "UNREACHABLE" });
  }
}
