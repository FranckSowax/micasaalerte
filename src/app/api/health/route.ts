import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Sonde de santé pour Railway (healthcheckPath dans railway.json).
// Volontairement sans appel à la base : elle indique seulement que le serveur répond.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
