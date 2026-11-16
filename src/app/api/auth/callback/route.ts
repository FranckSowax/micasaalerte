import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // SECURITY: seule une page du site est acceptée (« //autre.site » ou « @autre.site » renverraient ailleurs).
  const requested = searchParams.get("next") ?? "/dashboard";
  const next = /^\/(?![\/\\])[^@]*$/.test(requested) ? requested : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
