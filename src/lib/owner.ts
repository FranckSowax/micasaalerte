import { createServiceClient } from "@/lib/supabase/server";

// Compte principal de la plateforme : celui qui reçoit les abonnés inscrits depuis la page
// publique « Créer un compte » (sans lien d'agent particulier).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identifiant du compte principal : `OWNER_USER_ID` s'il est défini, sinon le plus ancien
 * compte agent (les comptes techniques wa-<numéro>@… sont ignorés).
 *
 * @example const ownerId = await ownerUserId(); // puis /demande/<ownerId>
 */
export async function ownerUserId(): Promise<string | null> {
  const configured = process.env.OWNER_USER_ID?.trim();
  if (configured && UUID.test(configured)) return configured;

  const { data, error } = await createServiceClient()
    .from("profiles")
    .select("id, email")
    .order("created_at", { ascending: true })
    .limit(20);
  if (error || !data) return null;
  const owner = data.find((p) => !/^wa-\d+@/i.test((p.email as string | null) || ""));
  return (owner?.id as string | undefined) ?? null;
}
