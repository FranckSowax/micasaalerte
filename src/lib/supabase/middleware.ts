import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { fetchAllowedAgentIds, isAgentApi } from "@/lib/agent-access";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Record<string, unknown>)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Doit couvrir toutes les pages du groupe (app) — à compléter à chaque nouvelle page.
  const protectedRoutes = [
    "/dashboard",
    "/annonces",
    "/carte",
    "/groupes",
    "/agents",
    "/contributeurs",
    "/tiktok",
    "/clients",
    "/paiements",
    "/verifications",
    "/envois",
    "/avis",
    "/whatsapp",
    "/diffusion",
    "/settings",
  ];
  const { pathname } = request.nextUrl;
  // Comparaison par segment : "/clients" ne doit pas protéger un futur "/clients-publics".
  const isProtected = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // SECURITY: un compte Supabase ne suffit pas, il faut être un agent autorisé (voir lib/agent-access).
  // En cas de doute (base injoignable), l'accès est refusé.
  if (user && (isProtected || isAgentApi(pathname))) {
    const allowed = await fetchAllowedAgentIds();
    if (!allowed || !allowed.has(user.id)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Accès réservé aux agents autorisés" }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/acces-refuse";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // /signup n'est pas concerné : c'est l'inscription des abonnés, ouverte à tous.
  if (request.nextUrl.pathname === "/login" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
