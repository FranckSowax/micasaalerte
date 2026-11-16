import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { runAllDrips } from "@/lib/diffusion-runner";

// Passage horaire de la diffusion (service Railway cron-diffusion). Protégé par CRON_SECRET :
// sans secret configuré, tout est refusé. Options : ?slot=N, ?dry=1, ?force=1.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const url = new URL(request.url);
  const slot = Number(url.searchParams.get("slot")) || undefined;
  const results = await runAllDrips(createServiceClient(), {
    origin: "cron",
    actor: "cron",
    slot,
    dry: url.searchParams.get("dry") === "1",
    force: url.searchParams.get("force") === "1",
  });
  return NextResponse.json({ success: true, results });
}

export const GET = handle;
export const POST = handle;
