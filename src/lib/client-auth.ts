import { createServiceClient } from "@/lib/supabase/server";
import { checkDevice, DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, generateDeviceId, hashDevice, isValidToken } from "@/lib/client-access";
import { checkRateLimit, getClientIp } from "@/lib/request-limit";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Contrôle d'accès des routes de l'espace client (/api/client/[token]/…) :
// jeton du lien personnel + appareil qui l'a ouvert en premier.

const READ_LIMIT = 60; // requêtes par minute et par adresse IP
const WINDOW_MS = 60_000;

export type DemandRow = Record<string, unknown>;

type Authorized = {
  error?: undefined;
  supabase: ReturnType<typeof createServiceClient>;
  demand: DemandRow;
  /** Identifiant à déposer en cookie quand l'appareil vient d'être lié. */
  newDeviceId: string | null;
};
type Refused = { error: NextResponse };

/**
 * Vérifie le jeton et l'appareil. Renvoie la demande, ou la réponse d'erreur à retourner.
 *
 * @example const auth = await authorizeClient(request, params.token); if (auth.error) return auth.error;
 */
export async function authorizeClient(request: Request, token: string): Promise<Authorized | Refused> {
  if (!isValidToken(token)) return { error: NextResponse.json({ error: "Lien invalide" }, { status: 404 }) };

  const limit = checkRateLimit(`client:${getClientIp(request)}`, READ_LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return { error: NextResponse.json({ error: "Trop de requêtes" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }) };
  }

  const supabase = createServiceClient();
  const { data } = await supabase.from("client_demands").select("*").eq("access_token", token).maybeSingle();
  const demand = data as DemandRow | null;
  if (!demand) return { error: NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 404 }) };

  const deviceId = cookies().get(DEVICE_COOKIE)?.value ?? null;
  const check = checkDevice(demand.device_hash as string | null, deviceId);
  if (check === "other_device") {
    return { error: NextResponse.json({ error: "Ce lien est déjà utilisé sur un autre appareil.", code: "other_device" }, { status: 403 }) };
  }

  let newDeviceId: string | null = null;
  if (check === "bind") {
    newDeviceId = deviceId || generateDeviceId();
    await supabase.from("client_demands").update({ device_hash: hashDevice(newDeviceId) }).eq("id", demand.id as string);
  }
  return { supabase, demand, newDeviceId };
}

/** Dépose le cookie d'appareil sur la réponse quand l'appareil vient d'être lié. */
export function withDeviceCookie(response: NextResponse, deviceId: string | null): NextResponse {
  if (deviceId) {
    response.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: DEVICE_COOKIE_MAX_AGE,
      path: "/",
    });
  }
  return response;
}
