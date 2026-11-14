import { describe, expect, it } from "vitest";
import { extractContacts, normalizePhone } from "./contacts";

describe("normalizePhone", () => {
  it.each([
    ["077 12 34 56", "+24177123456"],
    ["077123456", "+24177123456"],
    ["77 12 34 56", "+24177123456"],
    ["+241 77 12 34 56", "+24177123456"],
    ["00241 066 12 34 56", "+24166123456"],
    ["241077123456", "+24177123456"],
    ["24177123456", "+24177123456"],
    ["07 12 34 56", "+24177123456"], // ancienne numérotation à 8 chiffres
    ["06-12-34-56", "+24166123456"],
    ["011 44 55 66", "+24111445566"], // fixe
    ["+33 6 12 34 56 78", "+33612345678"],
  ])("normalise %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["150 000", "1 500 000", "12", "099 12 34 56", "abc", "+241 12"])("rejette %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("extractContacts", () => {
  it("relève plusieurs numéros sans doublon, dans l'ordre", () => {
    const c = extractContacts("Appelez le 077 12 34 56 ou le 066.11.22.33 (077123456)");
    expect(c.phones).toEqual(["+24177123456", "+24166112233"]);
  });

  it("sépare deux numéros écrits à la suite", () => {
    expect(extractContacts("Tel: 077 12 34 56 066 11 22 33").phones).toEqual(["+24177123456", "+24166112233"]);
    expect(extractContacts("077123456/066112233").phones).toEqual(["+24177123456", "+24166112233"]);
  });

  it("ne confond pas une surface ou une année avec un numéro", () => {
    expect(extractContacts("Terrain 1 200 m2, titre foncier 2024, 3 chambres 2 douches").phones).toEqual([]);
  });

  it("ne prend pas un prix pour un numéro", () => {
    const c = extractContacts("Villa à vendre 77 000 000 FCFA, loyer 650 000 F CFA, caution 66 000 000");
    expect(c.phones).toEqual([]);
  });

  it("reconnaît un lien wa.me comme WhatsApp", () => {
    const c = extractContacts("Infos : https://wa.me/24174001122 — tel 077 12 34 56");
    expect(c.whatsapp).toBe("+24174001122");
    expect(c.phones).toEqual(["+24174001122", "+24177123456"]);
  });

  it("reconnaît un lien api.whatsapp.com", () => {
    expect(extractContacts("https://api.whatsapp.com/send?phone=24166000001&text=hi").whatsapp).toBe("+24166000001");
  });

  it("associe le mot WhatsApp au numéro qui suit", () => {
    const c = extractContacts("Tel 077 12 34 56 / WhatsApp : 066 11 22 33");
    expect(c.whatsapp).toBe("+24166112233");
  });

  it("ne déclare pas de WhatsApp sans indice", () => {
    expect(extractContacts("Contact 077 12 34 56").whatsapp).toBeNull();
  });

  it("relève les e-mails en minuscules et sans doublon", () => {
    expect(extractContacts("Mail: Agence.Immo@Gmail.com ou agence.immo@gmail.com").emails).toEqual(["agence.immo@gmail.com"]);
  });

  it("renvoie des listes vides quand rien n'est publié", () => {
    expect(extractContacts("Belle maison à louer à Okala")).toEqual({ phones: [], whatsapp: null, emails: [] });
  });
});
