import { describe, expect, it } from "vitest";
import { configuredCustomerAuthorization } from "../src/customer-auth-config.js";

describe("customer authentication activation gate", () => {
  it("is off by default and does not require any provider or database", () => {
    expect(configuredCustomerAuthorization({})).toBeUndefined();
    expect(
      configuredCustomerAuthorization({ CHECKDROP_CUSTOMER_AUTH_ENABLED: "0" }),
    ).toBeUndefined();
  });
  it("rejects partial setup instead of silently weakening authentication", () => {
    expect(() => configuredCustomerAuthorization({ CHECKDROP_CUSTOMER_AUTH_ENABLED: "1" })).toThrow(
      "requires",
    );
    expect(() =>
      configuredCustomerAuthorization({ CHECKDROP_CUSTOMER_AUTH_ENABLED: "true" }),
    ).toThrow("0 or 1");
  });
});
