import { ALERT_TIMEZONE } from "./matching";

// Volume de messages WhatsApp envoyés par le numéro de la plateforme (WAHA), jour par jour.
// WHY: WhatsApp n'affiche aucun seuil officiel mais bannit un numéro qui envoie trop ; le compteur
// sert à voir quand on approche de la zone à risque et qu'il faut passer à l'API officielle.

export interface SendRow {
  sent_at: string | null;
  status: string | null;
}

export interface DayVolume {
  /** Jour au format AAAA-MM-JJ, heure de Libreville. */
  day: string;
  sent: number;
  failed: number;
}

/** Repères indicatifs (aucun seuil officiel) pour un numéro déjà ancien et actif. */
export const VOLUME_MODERATE_AT = 500;
export const VOLUME_HIGH_AT = 1000;

export type VolumeZone = "faible" | "modéré" | "élevé";

function localDay(date: Date, timeZone = ALERT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Messages envoyés et échoués par jour, du plus ancien au plus récent, jours vides compris.
 *
 * @example dailyVolumes(lignes, new Date(), 14).at(-1) // { day: "2026-11-16", sent: 42, failed: 1 }
 */
export function dailyVolumes(rows: SendRow[], now: Date = new Date(), days = 14): DayVolume[] {
  const result: DayVolume[] = [];
  const index = new Map<string, DayVolume>();
  for (let i = days - 1; i >= 0; i--) {
    const day = localDay(new Date(now.getTime() - i * 86_400_000));
    if (index.has(day)) continue;
    const entry = { day, sent: 0, failed: 0 };
    index.set(day, entry);
    result.push(entry);
  }
  for (const row of rows) {
    if (!row.sent_at) continue;
    const time = new Date(row.sent_at);
    if (Number.isNaN(time.getTime())) continue;
    const entry = index.get(localDay(time));
    if (!entry) continue;
    if (row.status === "failed") entry.failed++;
    else entry.sent++;
  }
  return result;
}

/** Niveau de risque d'un volume quotidien. */
export function volumeZone(sent: number): VolumeZone {
  if (sent >= VOLUME_HIGH_AT) return "élevé";
  if (sent >= VOLUME_MODERATE_AT) return "modéré";
  return "faible";
}
