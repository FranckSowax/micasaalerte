import { describe, expect, it } from "vitest";
import { allowedAgentIds, isAgentApi } from "./agent-access";

const OWNER = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const profiles = [
  { id: "44444444-4444-4444-8444-444444444444", email: "wa-24177000000@mca.local" },
  { id: OWNER, email: "patron@exemple.com" },
  { id: AGENT, email: "Agent@Exemple.com" },
  { id: STRANGER, email: "inconnu@pirate.test" },
];

describe("accès à l'administration", () => {
  it("sans liste, n'autorise que le compte principal (plus ancien compte agent)", () => {
    expect(allowedAgentIds(profiles, {})).toEqual(new Set([OWNER]));
    expect(allowedAgentIds(profiles, { OWNER_USER_ID: AGENT })).toEqual(new Set([AGENT]));
  });

  it("avec AGENT_EMAILS, autorise exactement les adresses listées, sans tenir compte de la casse", () => {
    const ids = allowedAgentIds(profiles, { AGENT_EMAILS: "patron@exemple.com, agent@exemple.com" });
    expect(ids).toEqual(new Set([OWNER, AGENT]));
    expect(ids.has(STRANGER)).toBe(false);
  });

  it("accepte aussi des identifiants, et jamais un compte technique WhatsApp", () => {
    expect(allowedAgentIds(profiles, { AGENT_USER_IDS: STRANGER })).toEqual(new Set([STRANGER]));
    expect(allowedAgentIds(profiles, { AGENT_EMAILS: "wa-24177000000@mca.local" }).size).toBe(0);
  });

  it("distingue les routes API publiques des routes agents", () => {
    for (const p of ["/api/annonces", "/api/whatsapp/channels", "/api/demands", "/api/demands/abc/subscription"]) expect(isAgentApi(p)).toBe(true);
    for (const p of ["/api/auth/otp/request", "/api/client/tok", "/api/demands/public", "/api/webhook/waha", "/api/cron/rss", "/api/health", "/api/quartiers"]) {
      expect(isAgentApi(p)).toBe(false);
    }
    expect(isAgentApi("/dashboard")).toBe(false);
  });
});
