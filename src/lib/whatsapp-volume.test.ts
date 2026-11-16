import { describe, expect, it } from "vitest";
import { dailyVolumes, volumeZone } from "./whatsapp-volume";

const NOW = new Date("2026-11-16T10:00:00Z"); // 11 h à Libreville

describe("volume de messages WhatsApp", () => {
  it("compte par jour à l'heure de Libreville, jours vides compris", () => {
    const rows = [
      { sent_at: "2026-11-16T09:00:00Z", status: "sent" },
      { sent_at: "2026-11-16T09:30:00Z", status: "failed" },
      { sent_at: "2026-11-15T23:30:00Z", status: "sent" }, // 00 h 30 le 16 à Libreville
      { sent_at: "2026-11-15T22:30:00Z", status: "sent" }, // 23 h 30 le 15
      { sent_at: "2026-11-01T10:00:00Z", status: "sent" }, // hors période
      { sent_at: null, status: "sent" },
    ];
    const days = dailyVolumes(rows, NOW, 3);
    expect(days.map((d) => d.day)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16"]);
    expect(days[2]).toEqual({ day: "2026-11-16", sent: 2, failed: 1 });
    expect(days[1].sent).toBe(1);
    expect(days[0].sent).toBe(0);
  });

  it("classe le volume en zones de risque", () => {
    expect(volumeZone(120)).toBe("faible");
    expect(volumeZone(500)).toBe("modéré");
    expect(volumeZone(1200)).toBe("élevé");
  });
});
