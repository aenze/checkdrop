import { describe, expect, it } from "vitest";
import {
  extractApiKeyPrefix,
  generatePilotApiKey,
  hashApiKey,
  hashIdempotencyKey,
  verifyApiKey,
} from "../src/api-key.js";

describe("pilot API keys", () => {
  it("generates a high-entropy key and stores only its one-way verifier", () => {
    const generated = generatePilotApiKey();

    expect(generated.key).toMatch(/^cdp_[a-f0-9]{12}_[A-Za-z0-9_-]{32,}$/);
    expect(extractApiKeyPrefix(generated.key)).toBe(generated.prefix);
    expect(generated.verifier).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(generated.verifier).not.toContain(generated.key);
    expect(verifyApiKey(generated.key, generated.verifier)).toBe(true);
    expect(verifyApiKey(`${generated.key}x`, generated.verifier)).toBe(false);
  });

  it("rejects malformed keys before storage lookup", () => {
    expect(extractApiKeyPrefix("not-a-key")).toBeNull();
    expect(extractApiKeyPrefix("cdp_123_short")).toBeNull();
  });

  it("hashes idempotency material without retaining it", () => {
    const hash = hashIdempotencyKey("pilot-secret-a", "form-submit-42");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashIdempotencyKey("pilot-secret-a", "form-submit-42"));
    expect(hash).not.toBe(hashIdempotencyKey("pilot-secret-b", "form-submit-42"));
    expect(hash).not.toContain("form-submit-42");
    expect(hashApiKey("example")).not.toBe(hash);
  });
});
