import { describe, expect, it } from "vitest";
import { resolveRecommendedAction } from "../src/index.js";

describe("resolveRecommendedAction", () => {
  it("never blocks an invalid value in assist mode", () => {
    expect(
      resolveRecommendedAction({
        status: "invalid",
        policy: "assist",
        allowBlocking: true,
      }),
    ).toBe("warn");
  });

  it("fails open when evidence is unknown", () => {
    expect(
      resolveRecommendedAction({
        status: "unknown",
        policy: "standard",
        allowBlocking: true,
      }),
    ).toBe("fail_open");
  });

  it("blocks a proven invalid value only when blocking is enabled", () => {
    expect(
      resolveRecommendedAction({
        status: "invalid",
        policy: "standard",
        allowBlocking: true,
      }),
    ).toBe("block");
  });
});
