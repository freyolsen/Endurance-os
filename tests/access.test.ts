import { it, expect, vi, afterEach } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import worker, { type Env } from "../worker";
afterEach(() => vi.unstubAllGlobals());
it("validates Access signature, issuer, audience, owner and expiry before sessions", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "fixture-key",
    alg: "RS256",
  };
  vi.stubGlobal("fetch", async () => Response.json({ keys: [jwk] }));
  const env = {
    AUTH_MODE: "access",
    APP_ORIGIN: "https://app.fixture.invalid",
    ACCESS_TEAM_DOMAIN: "team.fixture.invalid",
    ACCESS_AUD: "fixture-aud",
    OWNER_ACCESS_SUB: "owner-fixture",
    DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
  } as unknown as Env;
  const make = async (
    sub = "owner-fixture",
    aud = "fixture-aud",
    issuer = "https://team.fixture.invalid",
    exp = Math.floor(Date.now() / 1000) + 60,
  ) =>
    new SignJWT({ sub })
      .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
      .setIssuer(issuer)
      .setAudience(aud)
      .setExpirationTime(exp)
      .sign(privateKey);
  const call = async (jwt: string) =>
    worker.fetch(
      new Request("https://app.fixture.invalid/api/v1/profile", {
        headers: { "Cf-Access-Jwt-Assertion": jwt },
      }),
      env,
    );
  const valid = await call(await make());
  expect(valid.status).toBe(401);
  expect(await valid.json()).toMatchObject({
    error: { message: "Logg inn for å fortsette." },
  });
  for (const jwt of [
    "forged",
    await make("other"),
    await make("owner-fixture", "wrong"),
    await make("owner-fixture", "fixture-aud", "https://evil.invalid"),
    await make(
      "owner-fixture",
      "fixture-aud",
      "https://team.fixture.invalid",
      1,
    ),
  ]) {
    const r = await call(jwt);
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({
      error: { message: "Logg inn med eierkontoen." },
    });
  }
});
