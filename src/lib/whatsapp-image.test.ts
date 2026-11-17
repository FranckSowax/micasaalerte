import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsAppMessage } from "./whatsapp";

// Envoi du lien de l'espace avec la photo réglée dans Paramètres : la photo part avec le texte en
// légende ; si WAHA la refuse, le texte seul part quand même.

const IMAGE = "https://exemple.supabase.co/storage/v1/object/public/annonces/whatsapp/message-1.png";

describe("message WhatsApp avec image", () => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let answers: number[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("WAHA_API_URL", "https://waha.exemple.test");
    vi.stubEnv("WAHA_API_KEY", "cle-de-test");
    vi.stubEnv("WAHA_SESSION", "default");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ path: new URL(url).pathname, body: JSON.parse(String(init.body)) });
      const status = answers.shift() ?? 200;
      return new Response(JSON.stringify(status === 200 ? { id: "msg-1" } : { message: "refusé" }), { status });
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("envoie la photo avec le texte en légende", async () => {
    answers = [200];
    const result = await sendWhatsAppMessage("+241 77 00 00 00", "Bonjour", { image: IMAGE, log: false });
    expect(result).toEqual({ success: true, messageId: "msg-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/sendImage");
    expect(calls[0].body).toEqual({ session: "default", chatId: "24177000000@c.us", caption: "Bonjour", file: { url: IMAGE, mimetype: "image/png" } });
  });

  it("renvoie le texte seul si la photo est refusée", async () => {
    answers = [422, 200];
    const result = await sendWhatsAppMessage("24177000000", "Bonjour", { image: IMAGE, log: false });
    expect(result.success).toBe(true);
    expect(result.imageError).toContain("422");
    expect(calls.map((c) => c.path)).toEqual(["/api/sendImage", "/api/sendText"]);
    expect(calls[1].body).toEqual({ session: "default", chatId: "24177000000@c.us", text: "Bonjour" });
  });

  it("envoie du texte sans photo réglée", async () => {
    answers = [200];
    await sendWhatsAppMessage("24177000000", "Bonjour", { image: null, log: false });
    expect(calls.map((c) => c.path)).toEqual(["/api/sendText"]);
  });
});
