// Tri de l'abonné sur une annonce reçue (espace /c/[token]) : ce que chaque action enregistre
// dans client_demand_sends. Fonctions pures, testées à part.

/** Actions possibles depuis l'espace abonné. */
export const CLIENT_ACTIONS = ["keep", "remove", "reset", "delete"] as const;
export type ClientAction = (typeof CLIENT_ACTIONS)[number];

/** État enregistré pour chaque action. « deleted » : effacée de l'espace de l'abonné. */
export const STATUS_BY_ACTION = { keep: "kept", remove: "removed", reset: "new", delete: "deleted" } as const satisfies Record<ClientAction, string>;

/**
 * Colonnes à mettre à jour pour une action.
 * - « reset » efface l'avis (l'annonce redevient à trier).
 * - « delete » garde l'avis déjà donné : il continue de servir à l'apprentissage et aux signalements.
 * - sinon on enregistre l'avis qui accompagne la décision.
 *
 * @example decisionRow("delete", undefined, now) // { client_status: "deleted", decided_at: now }
 */
export function decisionRow(action: ClientAction, feedback: string | undefined, decidedAt: string): Record<string, unknown> {
  const row: Record<string, unknown> = { client_status: STATUS_BY_ACTION[action], decided_at: decidedAt };
  if (action === "reset") row.client_feedback = null;
  else if (action !== "delete") row.client_feedback = feedback ?? null;
  return row;
}

/** Une annonce supprimée par l'abonné n'apparaît plus dans son espace (elle n'est pas renvoyée non plus). */
export function isShownToClient(clientStatus: string | null | undefined): boolean {
  return clientStatus !== "deleted";
}
