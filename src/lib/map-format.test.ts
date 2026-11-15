import { describe, expect, it } from "vitest";
import { clusterByDistance, MIXED_COLOR, safeImageUrl, shortPrice, TRANSACTION_COLORS, transactionColor } from "./map-format";

describe("marqueurs de la carte", () => {
  it("abrège les prix", () => {
    expect(shortPrice(250000)).toBe("250k");
    expect(shortPrice(95000)).toBe("95k");
    expect(shortPrice(1500000)).toBe("1,5M");
    expect(shortPrice(12000000)).toBe("12M");
    expect(shortPrice(800)).toBe("800");
    expect(shortPrice(null)).toBe("");
    expect(shortPrice(0)).toBe("");
  });

  it("colore selon la transaction, en neutre si elles diffèrent", () => {
    expect(transactionColor(["location", "location"])).toBe(TRANSACTION_COLORS.location);
    expect(transactionColor(["vente"])).toBe(TRANSACTION_COLORS.vente);
    expect(transactionColor(["location", "vente"])).toBe(MIXED_COLOR);
    expect(transactionColor([null])).toBe(MIXED_COLOR);
  });

  it("regroupe les points proches à l'écran", () => {
    expect(clusterByDistance([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 200, y: 0 }, { x: 230, y: 0 }], 40)).toEqual([[0, 1], [2, 3]]);
    expect(clusterByDistance([{ x: 0, y: 0 }, { x: 100, y: 0 }], 40)).toEqual([[0], [1]]);
    expect(clusterByDistance([], 40)).toEqual([]);
  });

  it("n'accepte que les photos en HTTPS", () => {
    expect(safeImageUrl("https://x.supabase.co/a.jpg")).toBe("https://x.supabase.co/a.jpg");
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("http://a.test/b.jpg")).toBeNull();
    expect(safeImageUrl(null)).toBeNull();
  });
});
