// En-têtes de sécurité appliqués à toutes les pages et routes.
const SECURITY_HEADERS = [
  // HTTPS imposé pendant 2 ans, sous-domaines compris.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Pages jamais affichées dans un cadre d'un autre site (faux clics).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Localisation autorisée pour le site lui-même (bouton « Me localiser » de la carte), rien d'autre.
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // N'annonce pas la technologie utilisée.
  poweredByHeader: false,
  images: {
    // SECURITY: l'optimiseur d'images de Next 14 (/_next/image) a des failles critiques
    // (exécution de code via SVG/AVIF). Il est désactivé : les images sont servies telles quelles.
    // Aucune adresse distante n'est autorisée (l'ancien « *.supabase.co » acceptait n'importe quel projet).
    unoptimized: true,
    remotePatterns: [],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
