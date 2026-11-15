import { z } from "zod";

// Critères de recherche d'un client : validation partagée entre le formulaire public
// (création de la demande) et l'espace client (modification des critères).

// « colocation » n'est plus proposée dans le formulaire, mais reste acceptée pour les demandes existantes.
export const TYPE_OFFRE = ["location", "vente", "colocation"] as const;
// Du plus petit au plus grand.
export const TYPE_BIEN = ["chambre", "studio", "appartement", "maison", "villa", "commerce", "terrain"] as const;

const MAX_PRIX = 100_000_000_000; // 100 milliards FCFA
const prix = z.number().int().min(0).max(MAX_PRIX).nullish();

export const criteriaShape = {
  filter_type_offre: z.array(z.enum(TYPE_OFFRE)).max(TYPE_OFFRE.length).default([]),
  filter_type_bien: z.array(z.enum(TYPE_BIEN)).max(TYPE_BIEN.length).default([]),
  filter_prix_min: prix,
  filter_prix_max: prix,
  filter_nb_chambres_min: z.number().int().min(0).max(20).nullish(),
  filter_quartiers: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  // Secteur choisi sur la carte : un point au Gabon et un rayon de 1 à 5 km.
  geo_lat: z.number().min(-4.1).max(2.5).nullish(),
  geo_lon: z.number().min(8.5).max(14.7).nullish(),
  geo_radius_km: z.number().min(1).max(5).nullish(),
  filter_ville: z.string().trim().min(1).max(60).nullish(),
  exigences: z.string().trim().max(500).nullish(),
};

type BudgetFields = { filter_prix_min?: number | null; filter_prix_max?: number | null };

/** Le budget minimum ne dépasse pas le maximum. */
export const budgetIsCoherent = (d: BudgetFields) => !d.filter_prix_min || !d.filter_prix_max || d.filter_prix_min <= d.filter_prix_max;
export const BUDGET_ISSUE = { path: ["filter_prix_max"], message: "budget" };

export const CriteriaSchema = z.object(criteriaShape).refine(budgetIsCoherent, BUDGET_ISSUE);
export type CriteriaInput = z.infer<typeof CriteriaSchema>;

export const CRITERIA_FIELD_MESSAGES: Record<string, string> = {
  filter_prix_min: "Budget invalide",
  filter_prix_max: "Budget invalide : le minimum dépasse le maximum",
  filter_nb_chambres_min: "Nombre de chambres invalide",
  filter_quartiers: "Secteur trop étendu",
  geo_lat: "Secteur invalide",
  geo_lon: "Secteur invalide",
  geo_radius_km: "Distance invalide (1 à 5 km)",
  exigences: "Exigences trop longues (500 caractères maximum)",
};

/**
 * Colonnes de `client_demands` correspondant aux critères validés.
 * `zone` est séparé : ces colonnes viennent d'une migration, on peut enregistrer sans elles.
 *
 * @example const { filters, zone } = criteriaToRow(parsed.data)
 */
export function criteriaToRow(input: CriteriaInput) {
  const hasZone = typeof input.geo_lat === "number" && typeof input.geo_lon === "number";
  return {
    filters: {
      filter_type_offre: input.filter_type_offre,
      filter_type_bien: input.filter_type_bien,
      filter_prix_min: input.filter_prix_min || null,
      filter_prix_max: input.filter_prix_max || null,
      filter_nb_chambres_min: input.filter_nb_chambres_min || null,
      filter_quartiers: input.filter_quartiers,
      // Avec un secteur choisi sur la carte, la ville ne doit pas bloquer : Angondjé relève
      // d'Akanda, pas de Libreville. Le secteur fait foi.
      filter_ville: hasZone ? null : input.filter_ville || "Libreville",
      exigences: input.exigences || null,
    },
    zone: {
      geo_lat: hasZone ? input.geo_lat : null,
      geo_lon: hasZone ? input.geo_lon : null,
      geo_radius_km: hasZone ? (input.geo_radius_km ?? 1) : null,
    },
  };
}
