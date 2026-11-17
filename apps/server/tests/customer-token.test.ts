import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createCustomerTokenVerifier, customerRemoteKeys } from "../src/customer-token.js";

describe("verified customer tokens", () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let verify: ReturnType<typeof createCustomerTokenVerifier>;
  beforeAll(async () => {
    keys = await generateKeyPair("ES256");
    verify = createCustomerTokenVerifier({
      issuer: "https://identity.test",
      audience: "checkdrop-customers",
      keys: createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }),
    });
  });
  async function token(claims: Record<string, unknown> = {}, privateKey = keys.privateKey) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sub: "user-a",
      iss: "https://identity.test",
      aud: "checkdrop-customers",
      iat: now,
      exp: now + 300,
      ...claims,
    })
      .setProtectedHeader({ alg: "ES256" })
      .sign(privateKey);
  }
  it("accepts a signed current token but ignores role/project claims", async () => {
    expect(await verify(await token({ role: "owner", project: "victim" }))).toEqual({
      issuer: "https://identity.test",
      subject: "user-a",
    });
  });
  it.each([
    { exp: 1 },
    { iss: "https://attacker.test" },
    { aud: "another-app" },
    { sub: "" },
    { exp: undefined },
    { iat: undefined },
    { iat: 1 },
  ])("rejects invalid claims %j", async (claims) => {
    expect(await verify(await token(claims))).toBeNull();
  });
  it("rejects a signature from an unrelated key", async () => {
    const other = await generateKeyPair("ES256");
    expect(await verify(await token({}, other.privateKey))).toBeNull();
  });
  it("rejects a malformed token", async () => {
    expect(await verify("not.a.token")).toBeNull();
  });
  it.each(["http://example.test/keys", "https://user:pass@example.test/keys"])(
    "rejects unsafe JWKS configuration",
    (url) => {
      expect(() => customerRemoteKeys(url)).toThrow();
    },
  );
});
