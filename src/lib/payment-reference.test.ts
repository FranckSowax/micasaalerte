import { describe, expect, it } from "vitest";
import { isOrderReference, orderReference, paymentMerchant } from "./payment-reference";

const SECRET = "secret-de-test";
const DEMAND = "11111111-1111-4111-8111-111111111111";

describe("référence de commande", () => {
  it("a toujours la forme MCA + 6 chiffres", () => {
    for (let i = 0; i < 40; i++) expect(orderReference(`${DEMAND}-${i}`, i, SECRET)).toMatch(/^MCA\d{6}$/);
  });

  it("ne change pas tant que le paiement en cours n'est pas traité", () => {
    expect(orderReference(DEMAND, 0, SECRET)).toBe(orderReference(DEMAND, 0, SECRET));
  });

  it("change à chaque nouveau paiement, donc à chaque réabonnement", () => {
    const refs = new Set([0, 1, 2, 3].map((n) => orderReference(DEMAND, n, SECRET)));
    expect(refs.size).toBe(4);
  });

  it("diffère d'un abonné à l'autre et ne se devine pas sans le secret", () => {
    expect(orderReference(DEMAND, 0, SECRET)).not.toBe(orderReference("22222222-2222-4222-8222-222222222222", 0, SECRET));
    expect(orderReference(DEMAND, 0, SECRET)).not.toBe(orderReference(DEMAND, 0, "autre-secret"));
  });

  it("reconnaît une référence valide, quelle que soit la casse", () => {
    expect(isOrderReference("mca004217")).toBe(true);
    expect(isOrderReference("MKT0123")).toBe(false);
    expect(isOrderReference(null)).toBe(false);
  });
});

describe("coordonnées du marchand", () => {
  it("garde le code marchand et le nom par défaut", () => {
    expect(paymentMerchant({})).toMatchObject({ operator: "Airtel Money", ussd: "*150#", code: "M5309", name: "Moutouki Shop", contact: "077 24 72 45" });
  });

  it("se modifie par variables d'environnement", () => {
    expect(paymentMerchant({ PAYMENT_MERCHANT_CODE: " M9999 " }).code).toBe("M9999");
  });
});
