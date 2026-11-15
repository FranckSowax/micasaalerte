import { describe, expect, it } from "vitest";
import { checkCode, generateCode, isValidPhone, normalizePhone, OTP_TTL_MS, readChallenge, sealChallenge } from "./login-otp";

const SECRET = "secret-de-test";
const NOW = Date.parse("2026-11-15T12:00:00Z");

describe("numéro de connexion", () => {
  it("ne garde que les chiffres et retire le préfixe 00", () => {
    expect(normalizePhone("+241 77 12 34 56")).toBe("24177123456");
    expect(normalizePhone("00241-77-12-34-56")).toBe("24177123456");
    expect(isValidPhone("24177123456")).toBe(true);
    expect(isValidPhone("123")).toBe(false);
  });
});

describe("code de connexion", () => {
  it("fait toujours 6 chiffres", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("accepte le bon code et rend le numéro du défi", () => {
    const { cookie } = sealChallenge("24177123456", "042917", SECRET, NOW);
    const check = checkCode(cookie, "042917", SECRET, NOW + 1000);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.challenge.phone).toBe("24177123456");
  });

  it("refuse un mauvais code, un code mal formé ou un autre secret", () => {
    const { cookie } = sealChallenge("24177123456", "042917", SECRET, NOW);
    expect(checkCode(cookie, "042918", SECRET, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(checkCode(cookie, "42917", SECRET, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(checkCode(cookie, "042917", "autre-secret", NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(checkCode(null, "042917", SECRET, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuse le bon code après 5 minutes", () => {
    const { cookie } = sealChallenge("24177123456", "042917", SECRET, NOW);
    expect(checkCode(cookie, "042917", SECRET, NOW + OTP_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuse un cookie dont le numéro a été modifié", () => {
    const { cookie, challenge } = sealChallenge("24177123456", "042917", SECRET, NOW);
    const forged = Buffer.from(JSON.stringify({ ...challenge, phone: "24166000000" })).toString("base64url");
    expect(checkCode(`${forged}.${cookie.split(".")[1]}`, "042917", SECRET, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("ne révèle pas le code dans le cookie", () => {
    const { cookie } = sealChallenge("24177123456", "042917", SECRET, NOW);
    expect(Buffer.from(cookie.split(".")[0], "base64url").toString("utf8")).not.toContain("042917");
    expect(readChallenge(cookie)?.phone).toBe("24177123456");
    expect(readChallenge("illisible")).toBeNull();
  });
});
