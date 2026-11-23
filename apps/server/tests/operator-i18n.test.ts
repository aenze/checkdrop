import type { IntegrationStore } from "@checkdrop/db";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { detectFormFields, FormScanError } from "../src/form-scanner.js";

const operatorKey = "operator-secret-value";

function operatorApp() {
  // Every request below is rejected before the store is touched, except the lookup of a missing record.
  const store = { getIntegration: async () => null } as unknown as IntegrationStore;
  return createApp({
    integrationStore: store,
    operatorToken: operatorKey,
    operatorProjectRef: "project-a",
  });
}

function headers(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    "X-Checkdrop-Operator-Key": operatorKey,
    ...extra,
  };
}

describe("operator API language", () => {
  it("answers in Czech by default and in English with X-Checkdrop-Locale: en", async () => {
    const app = operatorApp();
    const czech = await app.request("/v1/operator/integrations/missing", { headers: headers() });
    expect(czech.status).toBe(404);
    await expect(czech.json()).resolves.toMatchObject({
      title: "Napojení nelze zpracovat",
      detail: "Napojení nebylo nalezeno.",
    });

    const english = await app.request("/v1/operator/integrations/missing", {
      headers: headers({ "X-Checkdrop-Locale": "en" }),
    });
    expect(english.status).toBe(404);
    await expect(english.json()).resolves.toMatchObject({
      title: "Connection request could not be processed",
      detail: "Connection not found.",
    });
  });

  it("falls back to Accept-Language and lets X-Checkdrop-Locale win", async () => {
    const app = operatorApp();
    const fromBrowser = await app.request("/v1/operator/integrations", {
      headers: { "X-Checkdrop-Operator-Key": "wrong", "Accept-Language": "en-GB,en;q=0.9" },
    });
    expect(fromBrowser.status).toBe(401);
    await expect(fromBrowser.json()).resolves.toMatchObject({
      detail: "Connection management requires a signed-in operator.",
    });

    const explicit = await app.request("/v1/operator/integrations", {
      headers: {
        "X-Checkdrop-Operator-Key": "wrong",
        "Accept-Language": "en-GB",
        "X-Checkdrop-Locale": "cs",
      },
    });
    await expect(explicit.json()).resolves.toMatchObject({
      detail: "Správa napojení vyžaduje přihlášeného operátora.",
    });
  });

  it("translates form URL errors raised by the scanner", async () => {
    const app = operatorApp();
    const body = JSON.stringify({
      name: "Shop",
      client_name: "shop",
      environment: "test",
      form_url: "http://shop.example/checkout",
    });
    const czech = await app.request("/v1/operator/integrations", {
      method: "POST",
      headers: headers(),
      body,
    });
    expect(czech.status).toBe(400);
    await expect(czech.json()).resolves.toMatchObject({
      detail: "Formulář musí být na veřejné HTTPS doméně.",
    });

    const english = await app.request("/v1/operator/integrations", {
      method: "POST",
      headers: headers({ "X-Checkdrop-Locale": "en" }),
      body,
    });
    await expect(english.json()).resolves.toMatchObject({
      detail: "The form must be on a public HTTPS domain.",
    });
  });

  it("translates field mapping problems", async () => {
    const app = operatorApp();
    const body = JSON.stringify({
      fields: [
        {
          selector: "#email",
          label: "E-mail",
          name: "email",
          canonical_field: "email",
          context: "shared",
          condition_key: null,
          required: true,
          require_domestic_address: true,
          validation_mode: "shadow",
          validation_trigger: "blur",
          confidence: 99,
          detected: true,
        },
      ],
    });
    const czech = await app.request("/v1/operator/integrations/missing/fields", {
      method: "PUT",
      headers: headers(),
      body,
    });
    expect(czech.status).toBe(409);
    await expect(czech.json()).resolves.toMatchObject({
      detail: "Doručení jen v ČR lze zapnout pouze u kontrolovaného PSČ.",
    });

    const english = await app.request("/v1/operator/integrations/missing/fields", {
      method: "PUT",
      headers: headers({ "X-Checkdrop-Locale": "en" }),
      body,
    });
    await expect(english.json()).resolves.toMatchObject({
      detail: "Delivery to the Czech Republic only can only be turned on for a checked PSČ.",
    });
  });

  it("translates a required phone on another field", async () => {
    const app = operatorApp();
    const body = JSON.stringify({
      fields: [
        {
          selector: "#email",
          label: "E-mail",
          name: "email",
          canonical_field: "email",
          context: "shared",
          condition_key: null,
          required: true,
          require_valid_phone: true,
          validation_mode: "shadow",
          validation_trigger: "blur",
          confidence: 99,
          detected: true,
        },
      ],
    });
    const czech = await app.request("/v1/operator/integrations/missing/fields", {
      method: "PUT",
      headers: headers(),
      body,
    });
    expect(czech.status).toBe(409);
    await expect(czech.json()).resolves.toMatchObject({
      detail: "Povinný platný telefon lze zapnout pouze u kontrolovaného telefonu.",
    });
    const english = await app.request("/v1/operator/integrations/missing/fields", {
      method: "PUT",
      headers: headers({ "X-Checkdrop-Locale": "en" }),
      body,
    });
    await expect(english.json()).resolves.toMatchObject({
      detail: "A required valid phone can only be turned on for a checked phone field.",
    });
  });

  it("keeps scanner error codes stable in both languages", () => {
    const error = new FormScanError("not_html", "Zadaná URL nevrací HTML stránku.", "Not HTML.");
    expect(error).toMatchObject({ code: "not_html", message: error.cs, en: "Not HTML." });
  });

  it("names unnamed scanned fields in the requested language", () => {
    const html = '<form><input type="text"></form>';
    const url = new URL("https://shop.example/checkout");
    expect(detectFormFields(html, url).fields[0]?.label).toBe("Nepojmenované pole");
    expect(detectFormFields(html, url, "en").fields[0]?.label).toBe("Unnamed field");
  });
});
