import { describe, expect, it } from "vitest";
import { checkDevice, clientLink, generateAccessToken, generateDeviceId, hashDevice, isValidToken, publicBaseUrl } from "./client-access";

describe("jeton d'accès", () => {
  it("est long, aléatoire et utilisable dans une adresse", () => {
    const a = generateAccessToken();
    const b = generateAccessToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(isValidToken(a)).toBe(true);
  });

  it.each(["", "court", "../../etc/passwd", "a".repeat(80), "avec espace dans le jeton 1234567", null, undefined])("refuse %s", (value) => {
    expect(isValidToken(value as string)).toBe(false);
  });

  it("construit le lien sans double barre oblique", () => {
    expect(clientLink("abc", "https://exemple.test/")).toBe("https://exemple.test/c/abc");
  });
});

describe("adresse publique du site", () => {
  it("garde l'adresse configurée quand elle est publique", () => {
    expect(publicBaseUrl({ NEXT_PUBLIC_APP_URL: "https://alerte.exemple.test/", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" })).toBe(
      "https://alerte.exemple.test"
    );
  });

  it("remplace une adresse locale ou absente par le domaine Railway", () => {
    expect(publicBaseUrl({ NEXT_PUBLIC_APP_URL: "http://localhost:3000", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" })).toBe("https://x.up.railway.app");
    expect(publicBaseUrl({ RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" })).toBe("https://x.up.railway.app");
  });

  it("laisse l'adresse locale en développement, sans domaine Railway", () => {
    expect(publicBaseUrl({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
  });
});

describe("lien non transférable", () => {
  const device = generateDeviceId();

  it("lie le premier appareil qui ouvre le lien", () => {
    expect(checkDevice(null, null)).toBe("bind");
    expect(checkDevice(null, device)).toBe("bind");
  });

  it("accepte ensuite ce même appareil", () => {
    expect(checkDevice(hashDevice(device), device)).toBe("ok");
  });

  it("refuse un autre appareil, ou un appareil sans cookie", () => {
    expect(checkDevice(hashDevice(device), generateDeviceId())).toBe("other_device");
    expect(checkDevice(hashDevice(device), null)).toBe("other_device");
  });

  it("n'enregistre qu'une empreinte, pas l'identifiant", () => {
    expect(hashDevice(device)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDevice(device)).not.toContain(device);
  });
});
