import { describe, expect, it } from "vitest";
import { generatePilotApiKey, verifyApiKey } from "../src/api-key.js";
import { assertInstanceSecrets, ensureConfiguredPilotKey } from "../src/instance-bootstrap.js";

const strong = {
  NODE_ENV: "production",
  CHECKDROP_DATABASE_URL: "postgresql://checkdrop:secret@postgres:5432/checkdrop",
  CHECKDROP_OPERATOR_TOKEN: "a".repeat(20) + "Zq9-".repeat(4) + "b".repeat(20),
  CHECKDROP_EMBED_SIGNING_SECRET: "k3".repeat(20),
  CHECKDROP_OBSERVATION_ENCRYPTION_KEY: "x".repeat(43),
};

describe("startup safety", () => {
  it("starts with strong generated secrets", () => {
    expect(() => assertInstanceSecrets(strong)).not.toThrow();
  });
  it("is not enforced outside production", () => {
    expect(() => assertInstanceSecrets({})).not.toThrow();
  });
  it.each([
    ["missing", { CHECKDROP_OPERATOR_TOKEN: "" }],
    ["short", { CHECKDROP_EMBED_SIGNING_SECRET: "short" }],
    ["sample", { CHECKDROP_OPERATOR_TOKEN: "local-operator-token-change-me-please-now" }],
    ["sample setup code", { CHECKDROP_ADMIN_SETUP_CODE: "replace-with-a-code-xx" }],
  ])("refuses a %s secret", (_label, override) => {
    expect(() => assertInstanceSecrets({ ...strong, ...override })).toThrow(/unsafe settings/);
  });
});

describe("generated administration key", () => {
  it("is registered once with only its verifier", async () => {
    const created: { keyPrefix: string; verifier: string; projectRef: string }[] = [];
    const store = {
      findApiKeyByPrefix: async (prefix: string) =>
        (created.find((key) => key.keyPrefix === prefix) as never) ?? null,
      createApiKey: async (input: { keyPrefix: string; verifier: string; projectRef: string }) => {
        created.push(input);
      },
    };
    const { key } = generatePilotApiKey();
    const env = { CHECKDROP_PILOT_API_KEY: key, CHECKDROP_OPERATOR_PROJECT_REF: "my-shop" };
    expect(await ensureConfiguredPilotKey(env, store as never)).toBe("registered");
    expect(await ensureConfiguredPilotKey(env, store as never)).toBe("present");
    expect(created).toHaveLength(1);
    expect(created[0]?.projectRef).toBe("my-shop");
    expect(verifyApiKey(key, created[0]?.verifier ?? "")).toBe(true);
    expect(JSON.stringify(created)).not.toContain(key);
    expect(
      await ensureConfiguredPilotKey({ CHECKDROP_PILOT_API_KEY: "nonsense" }, store as never),
    ).toBe("not_configured");
  });
});
