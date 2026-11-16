import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parseDripSlot, type DripFlux } from "@/lib/diffusion";
import { diffusionInstalled, runFlux } from "@/lib/diffusion-runner";

// « Publier maintenant » (ou « Aperçu ») depuis l'onglet Diffusion : même moteur que le cron, forcé.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const service = createServiceClient();
  if (!(await diffusionInstalled(service))) return NextResponse.json({ error: "Tables de la diffusion absentes : exécutez le script SQL." }, { status: 409 });

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  const slot = parseDripSlot(body.slot);
  const fluxes: DripFlux[] = body.flux === "products" ? ["products"] : body.flux === "announcements" ? ["announcements"] : ["products", "announcements"];
  const results = [];
  for (const flux of fluxes) {
    results.push({
      flux,
      result: await runFlux(service, { origin: "admin", actor: "admin", slot, flux, force: true, dry: body.dry === true, advance: body.advance !== false }),
    });
  }
  return NextResponse.json({ slot, results });
}
