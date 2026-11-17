import { describe, expect, it } from "vitest";
import { createShadowObservationCipher } from "../src/shadow-observation-crypto.js";

const testKey = Buffer.alloc(32, 7).toString("base64url");

describe("shadow observation encryption", () => {
  it("round-trips a full customer value without exposing it in the envelope", () => {
    const cipher = createShadowObservationCipher(testKey);
    expect(cipher).not.toBeNull();
    const envelope = cipher?.encrypt("jan.novak@example.cz", "observation-1:input") ?? "";

    expect(envelope).toMatch(/^v1\./);
    expect(envelope).not.toContain("jan.novak");
    expect(cipher?.decrypt(envelope, "observation-1:input")).toBe("jan.novak@example.cz");
  });

  it("rejects a value moved to a different observation or field", () => {
    const cipher = createShadowObservationCipher(testKey);
    const envelope = cipher?.encrypt("777 123 456", "observation-1:input") ?? "";

    expect(() => cipher?.decrypt(envelope, "observation-2:input")).toThrow();
    expect(() => cipher?.decrypt(envelope, "observation-1:proposed")).toThrow();
  });

  it("fails closed for an invalid key", () => {
    expect(() => createShadowObservationCipher("too-short")).toThrow(
      "CHECKDROP_OBSERVATION_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  });
});
