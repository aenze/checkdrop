import { describe, expect, it } from "vitest";
import type { IntegrationFormRecord, IntegrationRecord } from "../src/integration.js";
import { normalizeIntegrationPath, selectIntegrationForms } from "../src/integration.js";

const now = new Date("2026-08-19T08:00:00.000Z");

function form(
  id: string,
  pathPattern: string,
  matchMode: "exact" | "prefix",
  options: { readonly state?: "configured" | "paused"; readonly isDefault?: boolean } = {},
): IntegrationFormRecord {
  return {
    id,
    integrationId: "integration-1",
    name: id,
    formUrl: `https://shop.example${pathPattern}`,
    matchMode,
    pathPattern,
    state: options.state ?? "configured",
    configVersion: 2,
    isDefault: options.isDefault ?? false,
    createdAt: now,
    updatedAt: now,
    fields: [],
  };
}

function integration(forms: readonly IntegrationFormRecord[]): IntegrationRecord {
  return {
    id: "integration-1",
    projectRef: "project-1",
    name: "Example shop",
    clientName: "example-shop",
    environment: "test",
    formUrl: forms[0]?.formUrl ?? "https://shop.example/checkout",
    state: "shadow",
    configVersion: 3,
    createdAt: now,
    updatedAt: now,
    fields: [],
    forms,
    apiKeys: [],
    activity: { lastKeyUsedAt: null, observationCount24h: 0, lastObservationAt: null },
  };
}

describe("integration form routing", () => {
  it("normalizes trailing slashes and rejects query strings or external URLs", () => {
    expect(normalizeIntegrationPath("/checkout/")).toBe("/checkout");
    expect(normalizeIntegrationPath("/checkout?step=2")).toBeNull();
    expect(normalizeIntegrationPath("https://attacker.example/checkout")).toBeNull();
  });

  it("selects independent form roots on the same URL without crossing their scopes", () => {
    const checkout = {
      ...form("checkout", "/checkout", "exact", { isDefault: true }),
      rootSelector: "#checkout",
    };
    const registration = {
      ...form("registration", "/checkout", "exact"),
      rootSelector: "#registration",
    };
    const website = integration([checkout, registration]);

    expect(selectIntegrationForms(website, "/checkout").map((item) => item.id)).toEqual([
      "checkout",
      "registration",
    ]);
  });

  it("prefers an exact route over prefixes and then the longest matching prefix", () => {
    const website = integration([
      form("root", "/", "prefix", { isDefault: true }),
      form("account", "/account", "prefix"),
      form("register", "/account/register", "exact"),
    ]);

    expect(selectIntegrationForms(website, "/account/register")[0]?.id).toBe("register");
    expect(selectIntegrationForms(website, "/account/profile")[0]?.id).toBe("account");
    expect(selectIntegrationForms(website, "/contact")[0]?.id).toBe("root");
  });

  it("does not route to paused profiles and uses the configured default only for legacy scripts", () => {
    const website = integration([
      form("checkout", "/checkout", "exact", { isDefault: true }),
      form("register", "/register", "exact", { state: "paused" }),
    ]);

    expect(selectIntegrationForms(website, "/register")).toEqual([]);
    expect(selectIntegrationForms(website, "/unknown")).toEqual([]);
    expect(selectIntegrationForms(website, null)[0]?.id).toBe("checkout");
  });
});
