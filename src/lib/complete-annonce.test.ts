import { describe, expect, it } from "vitest";
import { isRicherText, looksTruncated } from "./complete-annonce";

const FIRST_LINE = "LOCATION APPARTEMENT 3CHAMBRES /BON STANDING | 📍";
const FULL = `${FIRST_LINE}
Zone GÉOGRAPHIQUE LIB#ALIBENDING
BORDURE DE ROUTE
- 3Chambre avec placards
- Prix : 450.000frcfa
CONDITION (S) :2 cautions/loyer
GARDIEN
Tél +241 000000000`;

describe("texte d'annonce tronqué par le flux", () => {
  it("repère une publication réduite à sa première ligne", () => {
    expect(looksTruncated(FIRST_LINE)).toBe(true);
    expect(looksTruncated(null)).toBe(true);
    expect(looksTruncated(FULL)).toBe(false);
  });

  it("réanalyse quand le nouveau texte est nettement plus complet", () => {
    expect(isRicherText(FULL, FIRST_LINE)).toBe(true);
  });

  it("ne réanalyse pas pour une variation mineure ou un texte plus court", () => {
    expect(isRicherText(`${FIRST_LINE} !`, FIRST_LINE)).toBe(false);
    expect(isRicherText(FIRST_LINE, FULL)).toBe(false);
    expect(isRicherText(`${FULL} Merci.`, FULL)).toBe(false);
  });
});
