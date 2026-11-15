import Image from "next/image";

/**
 * Logo Mi Casa Gabon. Version blanche sur fond sombre (espace agent), verte sur fond clair
 * (espace client, inscription). Le logo contient le nom : pas de texte à côté.
 *
 * @example <BrandLogo variant="green" className="h-10 w-auto" priority />
 */
export function BrandLogo({ variant = "white", className = "h-9 w-auto", priority = false }: { variant?: "white" | "green"; className?: string; priority?: boolean }) {
  return (
    <Image
      src={variant === "green" ? "/logo-green.png" : "/logo-white.png"}
      alt="Mi Casa Gabon"
      width={900}
      height={319}
      className={className}
      priority={priority}
    />
  );
}
