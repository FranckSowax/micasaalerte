import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number | null, devise = "FCFA"): string {
  if (!price) return "N/A";
  return new Intl.NumberFormat("fr-FR").format(price) + " " + devise;
}

export function formatDate(date: string | null): string {
  if (!date) return "N/A";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function getTypeBienLabel(type: string | null): string {
  const labels: Record<string, string> = {
    appartement: "Appartement",
    maison: "Maison",
    studio: "Studio",
    chambre: "Chambre",
    terrain: "Terrain",
    bureau: "Bureau",
    villa: "Villa",
  };
  return type ? labels[type] || type : "Non spécifié";
}

export function getTypeOffreLabel(type: string | null): string {
  const labels: Record<string, string> = {
    location: "Location",
    vente: "Vente",
    colocation: "Colocation",
    "sous-location": "Sous-location",
    recherche: "Recherche",
  };
  return type ? labels[type] || type : "Non spécifié";
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    new: "bg-blue-500/20 text-blue-400",
    sent: "bg-green-500/20 text-green-400",
    archived: "bg-gray-500/20 text-gray-400",
    favorite: "bg-yellow-500/20 text-yellow-400",
  };
  return colors[status] || "bg-gray-500/20 text-gray-400";
}
