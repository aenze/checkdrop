import type {
  AddressSearcher,
  CreatePilotApiKeyInput,
  PilotApiKeyRecord,
  PilotStore,
  RecordAssistInteractionInput,
  SaveShadowObservationInput,
  ShadowObservationStore,
  UsageEventInput,
} from "@checkdrop/db";
import { describe, expect, it, vi } from "vitest";
import { hashApiKey } from "../src/api-key.js";
import { createApp } from "../src/app.js";
import type { AresLookupResult } from "../src/providers/ares.js";
import { createPilotRateLimiter } from "../src/rate-limit.js";

const rawKey = `cdp_123456789abc_${"a".repeat(43)}`;
const activeKey: PilotApiKeyRecord = {
  id: "key-pilot-1",
  projectRef: "pilot-cz",
  name: "Czech pilot",
  keyPrefix: "cdp_123456789abc",
  verifier: hashApiKey(rawKey),
  state: "active",
};

describe("Node server foundation", () => {
  it("reports process health", async () => {
    const response = await createApp({ pilotStore: null }).request("/v1/health");
    await expect(response.json()).resolves.toMatchObject({
      object: "health_status",
      status: "ok",
      service: "checkdrop-server",
    });
  });

  it("publishes Czech internal API capability state without signup", async () => {
    const response = await createApp({ pilotStore: null }).request("/v1/capabilities");
    const body = (await response.json()) as {
      country_packs: Array<{ capabilities: Record<string, string> }>;
      internal_api: { public_signup: boolean; operations: string[] };
      shadow_pilot: {
        client: string;
        install: string;
        package_required: boolean;
        private_api_key_required: boolean;
        mode: string;
        mutates_input: boolean;
        assisted_email: {
          mode: string;
          configurable_per_field: boolean;
          automatic_input_mutation: boolean;
          submit_blocking: boolean;
        };
        assisted_phone: {
          country: string;
          mode: string;
          configurable_per_field: boolean;
          automatic_input_mutation: boolean;
          submit_blocking: boolean;
        };
        assisted_name: {
          mode: string;
          configurable_per_field: boolean;
          automatic_input_mutation: boolean;
          submit_blocking: boolean;
        };
        assisted_address: {
          country: string;
          source: string;
          mode: string;
          fills: string[];
          configurable_per_field: boolean;
          automatic_input_mutation: boolean;
          submit_blocking: boolean;
        };
        stores_raw_input: boolean;
        preview_retention_hours: number;
      };
    };
    expect(body.country_packs[0]?.capabilities.email).toBe("experimental");
    expect(body.country_packs[0]?.capabilities.vat).toBe("experimental");
    expect(body.country_packs[0]?.capabilities.addressSearch).toBe("experimental");
    expect(body.internal_api).toEqual({
      authentication: "api_key",
      public_signup: false,
      operations: [
        "email.validate",
        "name.validate",
        "phone.validate",
        "address.validate",
        "address.autocomplete",
        "company_id.validate",
        "company.autocomplete",
        "integration.config",
        "assist.interaction.record",
        "operator.shadow_observations.list",
      ],
    });
    expect(body.shadow_pilot).toEqual({
      client: "hosted_script",
      install: "one_script_tag",
      package_required: false,
      private_api_key_required: false,
      mode: "field_configurable_assist",
      mutates_input: true,
      assisted_email: {
        mode: "explicit_customer_confirmation",
        configurable_per_field: true,
        automatic_input_mutation: false,
        submit_blocking: false,
      },
      assisted_phone: {
        country: "CZ",
        mode: "silent_safe_auto_normalization",
        configurable_per_field: true,
        automatic_input_mutation: true,
        submit_blocking: false,
      },
      assisted_name: {
        mode: "non_blocking_full_name_guidance",
        configurable_per_field: true,
        automatic_input_mutation: false,
        submit_blocking: false,
      },
      assisted_address: {
        country: "CZ",
        source: "ruian",
        mode: "customer_confirmed_structured_autocomplete",
        fills: ["street_line", "city", "postal_code"],
        configurable_per_field: true,
        automatic_input_mutation: false,
        submit_blocking: false,
      },
      stores_raw_input: false,
      preview_retention_hours: 2160,
    });
  });

  it("reports full shadow values only when the configured store supports encryption", async () => {
    const response = await createApp({
      pilotStore: null,
      shadowObservationStore: memoryShadowObservationStore(),
    }).request("/v1/capabilities");

    await expect(response.json()).resolves.toMatchObject({
      shadow_pilot: { stores_raw_input: true, preview_retention_hours: 2160 },
    });
  });
});

describe("M1 internal API", () => {
  it("rejects protected validation without a pilot key", async () => {
    const store = memoryStore(activeKey);
    const response = await createApp({ pilotStore: store }).request("/v1/phones/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(store.events).toHaveLength(0);
  });

  it("validates one combined name field without mutating it", async () => {
    const store = memoryStore(activeKey);
    const response = await createApp({
      pilotStore: store,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    }).request("/v1/names/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Client": "checkout-test/1.0",
        "X-Checkdrop-Mode": "shadow",
      },
      body: JSON.stringify({
        full_name: "  Pavel   Novak , ",
        customer_type: "private",
        context: "billing",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("correctable");
    expect(body.suggestion).toBe("Pavel Novak");
    expect(body.issues.map((issue: { code: string }) => issue.code)).toEqual([
      "person.whitespace_normalized",
      "person.trailing_punctuation",
    ]);
    expect(store.events[0]?.operation).toBe("name.validate");
  });

  it("stores a safe full-name proposal in shadow mode without creating a mutation path", async () => {
    const observations = memoryShadowObservationStore();
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
      now: () => new Date("2026-08-21T09:00:00.000Z"),
    }).request("/v1/names/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({
        full_name: "MUDr.Michal POřický",
        customer_type: "private",
        context: "billing",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "correctable",
      action: "suggest",
      normalized: "MUDr. Michal Pořický",
      suggestion: "MUDr. Michal Pořický",
      issues: [{ code: "person.title_normalized" }, { code: "person.capitalization_normalized" }],
    });
    expect(response.headers.get("X-Checkdrop-Observation")).toBe("stored");
    expect(observations.observations[0]).toMatchObject({
      operation: "name.validate",
      inputValue: "MUDr.Michal POřický",
      proposedValue: "MUDr. Michal Pořický",
      changed: true,
      resultClass: "correctable",
      action: "suggest",
      issueCodes: ["person.title_normalized", "person.capitalization_normalized"],
    });
  });

  it("returns a service problem when pilot storage is not configured", async () => {
    const response = await createApp({ pilotStore: null }).request("/v1/phones/validate", {
      method: "POST",
    });
    expect(response.status).toBe(503);
  });

  it("records every e-mail validation while reusing one DNS lookup per domain", async () => {
    const store = memoryStore(activeKey);
    let id = 0;
    const lookupDns = vi.fn(async () => ({
      state: "resolved" as const,
      hasMx: true,
      hasAddress: true,
      checkedAt: "2026-08-15T12:00:00.000Z",
    }));
    const app = createApp({
      pilotStore: store,
      lookupDns,
      now: () => new Date("2026-08-15T12:00:00.000Z"),
      randomId: () => `generated-${++id}`,
    });
    const validate = (email: string) =>
      app.request("/v1/emails/validate", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
        body: JSON.stringify({ email, policy: "assist" }),
      });
    const first = await (await validate("jan@example.cz")).json();
    const second = await (await validate("jana@EXAMPLE.cz")).json();
    expect(lookupDns).toHaveBeenCalledTimes(1);
    expect(first.request_id).not.toBe(second.request_id);
    expect(first.status).toBe("valid");
    expect(second.status).toBe("valid");
    expect(store.events).toHaveLength(2);
  });

  it("validates email and records redacted, idempotent usage metadata", async () => {
    const store = memoryStore(activeKey);
    let id = 0;
    const app = createApp({
      pilotStore: store,
      lookupDns: async () => ({
        state: "resolved",
        hasMx: true,
        hasAddress: true,
        checkedAt: "2026-08-15T12:00:00.000Z",
      }),
      now: () => new Date("2026-08-15T12:00:00.000Z"),
      randomId: () => `generated-${++id}`,
    });
    const request = () =>
      app.request("/v1/emails/validate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Checkdrop-Key": rawKey,
          "Idempotency-Key": "form-submit-42",
        },
        body: JSON.stringify({ email: "jan@example.cz", policy: "assist" }),
      });

    const first = await request();
    const second = await request();
    const differentBody = await app.request("/v1/emails/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "Idempotency-Key": "form-submit-42",
      },
      body: JSON.stringify({ email: "jana@example.cz", policy: "assist" }),
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      object: "validation_result",
      status: "valid",
      action: "accept",
      normalized: "jan@example.cz",
    });
    expect(second.status).toBe(200);
    expect(differentBody.status).toBe(200);
    expect(store.events).toHaveLength(3);
    expect(store.events[0]).toMatchObject({
      projectRef: "pilot-cz",
      apiKeyId: "key-pilot-1",
      operation: "email.validate",
      units: 1,
      resultClass: "valid",
    });
    expect(store.events[0]?.idempotencyKeyHash).toBe(store.events[1]?.idempotencyKeyHash);
    expect(store.events[2]?.idempotencyKeyHash).not.toBe(store.events[0]?.idempotencyKeyHash);
    expect(JSON.stringify(store.events)).not.toContain("jan@example.cz");
    expect(JSON.stringify(store.events)).not.toContain("form-submit-42");
  });

  it("validates and normalizes a Czech phone number", async () => {
    const store = memoryStore(activeKey);
    const response = await createApp({ pilotStore: store }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "validation_result",
      status: "correctable",
      action: "suggest",
      normalized: "+420777123456",
    });
    expect(store.events[0]?.operation).toBe("phone.validate");
    expect(store.events[0]).toMatchObject({
      integrationMode: "api",
      clientName: null,
      durationMs: expect.any(Number),
    });
  });

  it("records bounded shadow metadata and exposes server validation timing", async () => {
    const store = memoryStore(activeKey);
    const ticks = [100, 112];
    const response = await createApp({
      pilotStore: store,
      monotonicNow: () => ticks.shift() ?? 112,
    }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "checkdrop-js/0.1.0",
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toContain("checkdrop;dur=12");
    expect(store.events[0]).toMatchObject({
      integrationMode: "shadow",
      clientName: "checkdrop-js/0.1.0",
      durationMs: 12,
    });
  });

  it("passes full values to the short-lived observation store with masked fallbacks", async () => {
    const store = memoryStore(activeKey);
    const observations = memoryShadowObservationStore();
    const response = await createApp({
      pilotStore: store,
      shadowObservationStore: observations,
      now: () => new Date("2026-08-17T09:00:00.000Z"),
    }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "checkout-phone-42",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Checkdrop-Observation")).toBe("stored");
    expect(observations.observations).toHaveLength(1);
    expect(observations.observations[0]).toMatchObject({
      projectRef: "pilot-cz",
      operation: "phone.validate",
      clientName: "eshop-checkout/1.0",
      inputValue: "777 123 456",
      proposedValue: "+420777123456",
      inputPreview: "••• ••• 456",
      proposedPreview: "+420 ••• ••• 456",
      changed: true,
      resultClass: "correctable",
      evidenceSources: ["libphonenumber"],
      durationMs: expect.any(Number),
      createdAt: new Date("2026-08-17T09:00:00.000Z"),
      expiresAt: new Date("2026-11-15T09:00:00.000Z"),
    });
    const stored = JSON.stringify(observations.observations);
    expect(stored).not.toContain("checkout-phone-42");
  });

  it("keeps the full e-mail correction beside its masked legacy fallback", async () => {
    const observations = memoryShadowObservationStore();
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
      lookupDns: async (domain) => ({
        state: domain === "gmial.com" ? "not_found" : "resolved",
        hasMx: domain !== "gmial.com",
        hasAddress: domain !== "gmial.com",
        checkedAt: "2026-08-17T09:00:00.000Z",
      }),
    }).request("/v1/emails/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({ email: "jan.novak@gmial.com" }),
    });

    expect(response.status).toBe(200);
    expect(observations.observations[0]).toMatchObject({
      inputValue: "jan.novak@gmial.com",
      proposedValue: "jan.novak@gmail.com",
      inputPreview: "j•••@gmial.com",
      proposedPreview: "j•••@gmail.com",
      changed: true,
      issueCodes: ["email.domain_typo"],
    });
  });

  it("records an identifiable assist decision against the encrypted observation", async () => {
    const observations = memoryShadowObservationStore();
    const app = createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
      lookupDns: async () => ({
        state: "resolved",
        hasMx: true,
        hasAddress: true,
        checkedAt: "2026-08-17T09:00:00.000Z",
      }),
      now: () => new Date("2026-08-17T09:00:00.000Z"),
    });
    const validation = await app.request("/v1/emails/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({ email: "audit.customer@gmial.com" }),
    });
    const result = (await validation.json()) as { request_id: string };

    const interaction = await app.request("/v1/assist/interactions", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
      body: JSON.stringify({ request_id: result.request_id, event: "applied" }),
    });

    expect(interaction.status).toBe(204);
    expect(observations.observations[0]?.inputValue).toBe("audit.customer@gmial.com");
    expect(observations.interactions).toEqual([
      {
        projectRef: "pilot-cz",
        apiKeyId: "key-pilot-1",
        requestId: result.request_id,
        event: "applied",
        occurredAt: new Date("2026-08-17T09:00:00.000Z"),
      },
    ]);
  });

  it("validates a Czech address and retains the full short-lived proposal", async () => {
    const observations = memoryShadowObservationStore();
    const searched: string[] = [];
    const addressSearcher = matchedAddressSearcher(searched);
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
      addressSearcher,
      now: () => new Date("2026-08-17T09:00:00.000Z"),
    }).request("/v1/addresses/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({
        first_name: "Jan",
        last_name: "Novák",
        address: "Karlovo náměstí 19",
        city: "Praha 2",
        postal_code: "120 00",
        country: "CZ",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "correctable",
      action: "suggest",
      suggestion: "Karlovo náměstí 19/13, Nové Město, 120 00 Praha 2",
    });
    expect(searched).toEqual(["Karlovo náměstí 19, Praha 2, 12000"]);
    expect(observations.observations[0]).toMatchObject({
      operation: "address.validate",
      inputValue: "Karlovo náměstí 19, Praha 2, 12000",
      proposedValue: "Karlovo náměstí 19/13, Nové Město, 120 00 Praha 2",
      inputPreview: "Karlovo náměstí ••, Praha •, •••••",
      proposedPreview: "Karlovo náměstí ••/••, Nové Město, ••• •• Praha •",
      changed: true,
      issueCodes: ["address.ruian_normalized"],
      evidenceSources: ["ruian"],
    });
    const stored = JSON.stringify(observations.observations);
    expect(stored).not.toContain('"first_name":"Jan"');
    expect(stored).not.toContain('"last_name":"Novák"');
  });

  it("passes address components to the search and returns its advice", async () => {
    const seen: unknown[] = [];
    const searcher: AddressSearcher = {
      async search(input, options) {
        seen.push({ input, components: options?.components });
        const result = await matchedAddressSearcher([]).search(input, options);
        return {
          ...result,
          advice: { code: "address.postal_code_mismatch", postal_code: "12000" },
        };
      },
      async close() {},
    };
    const app = createApp({ pilotStore: memoryStore(activeKey), addressSearcher: searcher });
    const request = (body: object) =>
      app.request("/v1/addresses/autocomplete", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
        body: JSON.stringify(body),
      });
    const components = { street_line: " Karlovo náměstí 19 ", city: "Praha", postal_code: "12001" };

    const ok = await request({ query: "Karlovo náměstí 19 Praha 12001", components });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({
      status: "matched",
      advice: { code: "address.postal_code_mismatch", postal_code: "12000" },
    });
    expect(seen).toEqual([{ input: "Karlovo náměstí 19 Praha 12001", components }]);

    const mismatch = await request({ query: "Karlovo náměstí 19 Praha", components });
    expect(mismatch.status).toBe(400);
    const extraKey = await request({
      query: "Karlovo náměstí 19 Praha 12001",
      components: { ...components, country: "CZ" },
    });
    expect(extraKey.status).toBe(400);
    const tooLong = await request({
      query: "x".repeat(10),
      components: { street_line: "x".repeat(201), city: "", postal_code: "" },
    });
    expect(tooLong.status).toBe(400);

    const legacy = await request({ query: "Karlovo náměstí 19 Praha 12001" });
    expect(legacy.status).toBe(200);
    expect((seen.at(-1) as { components?: unknown }).components).toBeUndefined();
  });

  it("offers no Czech address for a Slovak PSČ or town and records the country mismatch", async () => {
    const searched: string[] = [];
    const observations = memoryShadowObservationStore();
    const app = createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
      addressSearcher: matchedAddressSearcher(searched),
    });
    const request = (body: object) =>
      app.request("/v1/addresses/autocomplete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Checkdrop-Key": rawKey,
          "X-Checkdrop-Mode": "shadow",
          "X-Checkdrop-Client": "eshop-checkout/1.0",
          "X-Checkdrop-Observe": "preview",
        },
        body: JSON.stringify(body),
      });
    for (const components of [
      { street_line: "Hlavná 12", city: "Topoľčany", postal_code: "955 01" },
      { street_line: "Hlavná 12", city: "Šaľa", postal_code: "" },
    ]) {
      const query = [components.street_line, components.city, components.postal_code]
        .filter(Boolean)
        .join(" ");
      const response = await request({ query, country: "CZ", limit: 5, components });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "no_match",
        advice: { code: "address.country_mismatch" },
        suggestions: [],
      });
    }
    expect(searched).toEqual([]);
    expect(observations.observations[0]).toMatchObject({
      resultClass: "risky",
      action: "warn",
      issueCodes: ["address.autocomplete_no_match", "address.country_mismatch"],
    });

    const czech = await request({
      query: "Bratislavská 12 Břeclav 690 02",
      country: "CZ",
      limit: 5,
      components: { street_line: "Bratislavská 12", city: "Břeclav", postal_code: "690 02" },
    });
    await expect(czech.json()).resolves.toMatchObject({ status: "matched" });
    expect(searched).toEqual(["Bratislavská 12 Břeclav 690 02"]);
  });

  it("stores the RÚIAN proposal and records the address the customer selected", async () => {
    const store = memoryStore(activeKey);
    const observations = memoryShadowObservationStore();
    const searched: string[] = [];
    const app = createApp({
      pilotStore: store,
      shadowObservationStore: observations,
      addressSearcher: matchedAddressSearcher(searched),
      now: () => new Date("2026-08-17T09:00:00.000Z"),
      monotonicNow: (() => {
        const ticks = [10, 17];
        return () => ticks.shift() ?? 17;
      })(),
    });
    const response = await app.request("/v1/addresses/autocomplete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({ query: "Karlovo náměstí 19", country: "CZ", limit: 6 }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Server-Timing")).toContain("checkdrop;dur=7");
    const result = (await response.json()) as {
      request_id: string;
      suggestions: Array<{ label: string }>;
    };
    expect(result).toMatchObject({
      object: "address_suggestion_list",
      status: "matched",
      country: "CZ",
      suggestions: [
        {
          id: "ruian-address-1",
          label: "Karlovo náměstí 19/13, Nové Město, 120 00 Praha 2",
          street_line: "Karlovo náměstí 19/13",
          street: "Karlovo náměstí",
          house_number: "19",
          orientation_number: "13",
          city: "Praha",
          city_part: "Praha 2",
          postal_code: "12000",
        },
      ],
      evidence: [{ source: "ruian", state: "confirmed", detail: "ruian.snapshot.2026-08-01" }],
    });
    expect(searched).toEqual(["Karlovo náměstí 19"]);
    expect(store.events[0]).toMatchObject({
      operation: "address.autocomplete",
      resultClass: "matched",
      integrationMode: "shadow",
    });
    expect(JSON.stringify(store.events)).not.toContain("Karlovo náměstí 19");
    expect(observations.observations[0]).toMatchObject({
      operation: "address.validate",
      inputValue: "Karlovo náměstí 19",
      proposedValue: "Karlovo náměstí 19/13, Nové Město, 120 00 Praha 2",
      resultClass: "correctable",
      action: "suggest",
      issueCodes: ["address.autocomplete_suggestion"],
      evidenceSources: ["ruian"],
    });

    const selectedAddress = "Karlovo náměstí 20, Nové Město, 120 00 Praha 2";
    const interaction = await app.request("/v1/assist/interactions", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
      body: JSON.stringify({
        request_id: result.request_id,
        event: "applied",
        proposed_value: selectedAddress,
      }),
    });
    expect(interaction.status).toBe(204);
    expect(observations.interactions[0]).toMatchObject({
      event: "applied",
      proposedValue: selectedAddress,
      proposedPreview: "Karlovo náměstí ••, Nové Město, ••• •• Praha •",
    });
  });

  it("rejects an address proposal unless the customer applied it", async () => {
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: memoryShadowObservationStore(),
    }).request("/v1/assist/interactions", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
      body: JSON.stringify({
        request_id: "7e3c2d1a-4b5f-4f62-8a73-5c6d7e8f9012",
        event: "shown",
        proposed_value: "Karlovo náměstí 19, Praha",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      detail: "Field 'proposed_value' is only supported for a selected address.",
    });
  });

  it("fails open with no autocomplete suggestions when RÚIAN is unavailable", async () => {
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      addressSearcher: null,
      now: () => new Date("2026-08-17T09:00:00.000Z"),
    }).request("/v1/addresses/autocomplete", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
      body: JSON.stringify({ query: "Karlovo náměstí" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "address_suggestion_list",
      status: "unavailable",
      suggestions: [],
      evidence: [{ source: "ruian", state: "unavailable" }],
    });
  });

  it("rejects foreign countries in the Czech autocomplete pilot", async () => {
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      addressSearcher: matchedAddressSearcher([]),
    }).request("/v1/addresses/autocomplete", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
      body: JSON.stringify({ query: "Bratislava", country: "SK" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      title: "Invalid request",
      detail: "Only country 'CZ' is supported.",
    });
  });

  it("marks an otherwise valid address invalid when first name and last name are not filled", async () => {
    const observations = memoryShadowObservationStore();
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
      addressSearcher: matchedAddressSearcher([]),
      now: () => new Date("2026-08-17T09:00:00.000Z"),
    }).request("/v1/addresses/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({
        first_name: "   ",
        last_name: "123",
        address: "Karlovo náměstí 19",
        city: "Praha 2",
        postal_code: "120 00",
        country: "CZ",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "invalid",
      action: "block",
      issues: [
        { code: "person.first_name_missing", severity: "error" },
        { code: "person.last_name_missing", severity: "error" },
        { code: "address.ruian_normalized", severity: "warning" },
      ],
    });
    expect(observations.observations[0]).toMatchObject({
      resultClass: "invalid",
      action: "block",
      issueCodes: [
        "person.first_name_missing",
        "person.last_name_missing",
        "address.ruian_normalized",
      ],
    });
  });

  it("rejects an obvious Slovak address when the declared country is Czech Republic", async () => {
    const observations = memoryShadowObservationStore();
    let searches = 0;
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
      addressSearcher: {
        async search() {
          searches += 1;
          throw new Error("Country mismatch must be rejected before RÚIAN search");
        },
        async close() {},
      },
      now: () => new Date("2026-08-17T09:00:00.000Z"),
    }).request("/v1/addresses/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({
        first_name: "Ján",
        last_name: "Novák",
        address: "Dunajská 1",
        city: "Bratislava, Slovensko",
        postal_code: "811 01",
        country: "CZ",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "invalid",
      action: "block",
      suggestion: null,
      issues: [{ code: "address.country_mismatch", severity: "error" }],
      evidence: [{ source: "country", state: "confirmed" }],
    });
    expect(searches).toBe(0);
    expect(observations.observations[0]).toMatchObject({
      operation: "address.validate",
      inputValue: "Dunajská 1, Bratislava, Slovensko, 81101",
      inputPreview: "Dunajská •, Bratislava, Slovensko, •••••",
      proposedValue: null,
      proposedPreview: null,
      changed: false,
      resultClass: "invalid",
      action: "block",
      issueCodes: ["address.country_mismatch"],
      evidenceSources: ["country"],
    });
    expect(JSON.stringify(observations.observations)).not.toContain('"first_name":"Ján"');
  });

  it("checks a normalized Czech IČO in ARES and masks all but its ending", async () => {
    const observations = memoryShadowObservationStore();
    const lookedUp: string[] = [];
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
      lookupAres: async (input) => {
        lookedUp.push(input);
        return confirmedAresResult(input);
      },
      now: () => new Date("2026-08-17T09:00:00.000Z"),
    }).request("/v1/company-ids/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({ company_id: "000 06 947", country: "CZ" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "correctable",
      action: "normalize",
      normalized: "00006947",
      suggestion: null,
      company: {
        name: "Ministerstvo financí",
        registered_office: { city: "Praha", postal_code: "11800", country: "CZ" },
      },
    });
    expect(lookedUp).toEqual(["000 06 947"]);
    expect(observations.observations[0]).toMatchObject({
      operation: "company_id.validate",
      inputValue: "000 06 947",
      proposedValue: "00006947",
      inputPreview: "••• •• 947",
      proposedPreview: "•••••947",
      changed: true,
      issueCodes: ["company.ico_normalized"],
      evidenceSources: ["ares"],
    });
  });

  it("returns at most five structured ARES company suggestions", async () => {
    const searched: string[] = [];
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      searchAres: async (query) => {
        searched.push(query);
        const company = confirmedAresResult("00006947").company;
        return {
          object: "company_suggestion_list",
          provider: "ares",
          input: query,
          status: "matched",
          companies: company ? [company] : [],
          issues: [],
          evidence: [],
        };
      },
      now: () => new Date("2026-08-17T09:00:00.000Z"),
    }).request("/v1/companies/autocomplete", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
      body: JSON.stringify({ query: "Ministerstvo", country: "CZ", limit: 5 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "company_suggestion_list",
      status: "matched",
      suggestions: [{ ico: "00006947", name: "Ministerstvo financí" }],
    });
    expect(searched).toEqual(["Ministerstvo"]);
  });

  it("keeps an ARES outage for 10 s only, then asks ARES again", async () => {
    let calls = 0;
    let now = new Date("2026-09-25T09:00:00.000Z");
    const app = createApp({
      pilotStore: memoryStore(activeKey),
      searchAres: async () => {
        calls += 1;
        throw new Error("ARES timeout");
      },
      now: () => now,
    });
    const search = async () => {
      const response = await app.request("/v1/companies/autocomplete", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
        body: JSON.stringify({ query: "Ministerstvo", country: "CZ" }),
      });
      return ((await response.json()) as { status: string }).status;
    };

    expect(await search()).toBe("unavailable");
    expect(await search()).toBe("unavailable");
    expect(calls).toBe(1);
    now = new Date("2026-09-25T09:00:10.001Z");
    expect(await search()).toBe("unavailable");
    expect(calls).toBe(2);
  });

  it("keeps validation fail-open when optional shadow preview storage is unavailable", async () => {
    const observations = memoryShadowObservationStore();
    observations.save = async () => {
      throw new Error("observation database unavailable");
    };
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
    }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "eshop-checkout/1.0",
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Checkdrop-Observation")).toBe("unavailable");
    await expect(response.json()).resolves.toMatchObject({ status: "correctable" });
  });

  it("requires explicit shadow mode before preview observation can be enabled", async () => {
    const observations = memoryShadowObservationStore();
    const response = await createApp({
      pilotStore: memoryStore(activeKey),
      shadowObservationStore: observations,
    }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Observe": "preview",
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });

    expect(response.status).toBe(400);
    expect(observations.observations).toHaveLength(0);
  });

  it("rejects malformed shadow metadata before validation is recorded", async () => {
    const store = memoryStore(activeKey);
    const app = createApp({ pilotStore: store });
    const missingClient = await app.request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });
    const unsafeClient = await app.request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "checkdrop js; secret",
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });
    const numericClient = await app.request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Checkdrop-Mode": "shadow",
        "X-Checkdrop-Client": "420777123456",
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });

    expect(missingClient.status).toBe(400);
    expect(unsafeClient.status).toBe(400);
    expect(numericClient.status).toBe(400);
    expect(store.events).toHaveLength(0);
  });

  it("generates correlation IDs server-side before they reach the usage ledger", async () => {
    const store = memoryStore(activeKey);
    const response = await createApp({ pilotStore: store }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "X-Request-Id": "420777123456",
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });
    const payload = (await response.json()) as { request_id: string };

    expect(response.status).toBe(200);
    expect(payload.request_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(payload.request_id).not.toBe("420777123456");
    expect(store.events[0]?.requestId).toBe(payload.request_id);
    expect(JSON.stringify(store.events)).not.toContain("420777123456");
  });

  it("rejects unsupported and oversized bodies before parsing or usage recording", async () => {
    const store = memoryStore(activeKey);
    const app = createApp({ pilotStore: store });
    const unsupported = await app.request("/v1/phones/validate", {
      method: "POST",
      headers: { "content-type": "text/plain", "X-Checkdrop-Key": rawKey },
      body: "{}",
    });
    const oversized = await app.request("/v1/phones/validate", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
      body: "x".repeat(8_193),
    });
    const oversizedDeclared = await app.request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-length": "9000",
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
      },
      body: "{}",
    });

    expect(unsupported.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(oversizedDeclared.status).toBe(413);
    expect(store.events).toHaveLength(0);
  });

  it("throttles a pilot key before repeated validation work", async () => {
    const store = memoryStore(activeKey);
    const app = createApp({
      pilotStore: store,
      rateLimiter: createPilotRateLimiter({
        now: () => 0,
        globalAuthenticationLimit: 10,
        prefixAuthenticationLimit: 10,
        keyValidationLimit: 1,
      }),
    });
    const request = () =>
      app.request("/v1/phones/validate", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Checkdrop-Key": rawKey },
        body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
      });

    expect((await request()).status).toBe(200);
    const throttled = await request();
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBe("60");
    expect(store.events).toHaveLength(1);
  });

  it("rejects an oversized idempotency key before validation is recorded", async () => {
    const store = memoryStore(activeKey);
    const response = await createApp({ pilotStore: store }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "Idempotency-Key": "x".repeat(129),
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });

    expect(response.status).toBe(400);
    expect(store.events).toHaveLength(0);
  });

  it("rejects empty idempotency headers and unsupported body fields", async () => {
    const store = memoryStore(activeKey);
    const emptyHeader = await createApp({ pilotStore: store }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
        "Idempotency-Key": "   ",
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });
    const extraField = await createApp({ pilotStore: store }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ", raw: true }),
    });

    expect(emptyHeader.status).toBe(400);
    expect(extraField.status).toBe(400);
    expect(store.events).toHaveLength(0);
  });

  it("fails closed when mandatory usage recording fails", async () => {
    const store = memoryStore(activeKey);
    store.recordUsage = async () => {
      throw new Error("database unavailable");
    };
    const response = await createApp({ pilotStore: store }).request("/v1/phones/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Checkdrop-Key": rawKey,
      },
      body: JSON.stringify({ phone: "777 123 456", country: "CZ" }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      title: "Internal API unavailable",
      detail: "Usage recording is temporarily unavailable.",
    });
  });
});

function memoryStore(key: PilotApiKeyRecord): PilotStore & { events: UsageEventInput[] } {
  const events: UsageEventInput[] = [];
  return {
    events,
    async findApiKeyByPrefix(prefix) {
      return prefix === key.keyPrefix ? key : null;
    },
    async createApiKey(_input: CreatePilotApiKeyInput) {},
    async recordUsage(input) {
      events.push(input);
      return true;
    },
    async close() {},
  };
}

function memoryShadowObservationStore(): ShadowObservationStore & {
  observations: SaveShadowObservationInput[];
  interactions: RecordAssistInteractionInput[];
} {
  const observations: SaveShadowObservationInput[] = [];
  const interactions: RecordAssistInteractionInput[] = [];
  return {
    fullValuesEnabled: true,
    observations,
    interactions,
    async save(input) {
      if (
        observations.some(
          (observation) =>
            observation.apiKeyId === input.apiKeyId &&
            observation.operation === input.operation &&
            observation.idempotencyKeyHash === input.idempotencyKeyHash,
        )
      ) {
        return false;
      }
      observations.push(input);
      return true;
    },
    async recordAssistInteraction(input) {
      interactions.push(input);
      return observations.some(
        (observation) =>
          observation.projectRef === input.projectRef &&
          observation.apiKeyId === input.apiKeyId &&
          observation.requestId === input.requestId,
      );
    },
    async list(projectRef, now, options) {
      const matching = observations
        .filter(
          (observation) =>
            observation.projectRef === projectRef &&
            observation.expiresAt.getTime() > now.getTime(),
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      const filtered = matching.filter((observation) => {
        if (options.operation && observation.operation !== options.operation) return false;
        if (options.resultClass && observation.resultClass !== options.resultClass) return false;
        if (options.clientName && observation.clientName !== options.clientName) return false;
        if (options.formId && observation.formId !== options.formId) return false;
        if (
          options.checkoutSessionRef &&
          observation.checkoutSessionRef !== options.checkoutSessionRef
        )
          return false;
        if (options.from && observation.createdAt < options.from) return false;
        if (options.to && observation.createdAt > options.to) return false;
        if (options.filter === "changed") return observation.changed;
        if (options.filter === "review") {
          return ["risky", "invalid", "unknown"].includes(observation.resultClass);
        }
        return true;
      });
      const caseKey = (observation: SaveShadowObservationInput) =>
        observation.checkoutSessionRef
          ? `session:${observation.checkoutSessionRef}`
          : `observation:${observation.id}`;
      const filteredCaseKeys = [...new Set(filtered.map(caseKey))];
      const selectedCaseKeys = new Set(
        filteredCaseKeys.slice(options.offset, options.offset + options.limit),
      );
      const selectedObservations = matching.filter((observation) =>
        selectedCaseKeys.has(caseKey(observation)),
      );
      const durations = matching.map((observation) => observation.durationMs).sort((a, b) => a - b);
      const average =
        durations.length === 0
          ? 0
          : Math.round(
              (durations.reduce((total, duration) => total + duration, 0) / durations.length) * 10,
            ) / 10;
      const p95Index = durations.length === 0 ? 0 : Math.ceil(durations.length * 0.95) - 1;
      return {
        observations: selectedObservations.map((input) => ({
          id: input.id,
          requestId: input.requestId,
          operation: input.operation,
          clientName: input.clientName,
          formId: input.formId,
          formName: null,
          checkoutSessionRef: input.checkoutSessionRef,
          inputValue: input.inputValue,
          proposedValue: input.proposedValue,
          inputPreview: input.inputPreview,
          proposedPreview: input.proposedPreview,
          changed: input.changed,
          resultClass: input.resultClass,
          action: input.action,
          issueCodes: input.issueCodes,
          evidenceSources: input.evidenceSources,
          durationMs: input.durationMs,
          assistShownAt: null,
          assistOutcome: null,
          assistOutcomeAt: null,
          createdAt: input.createdAt,
          expiresAt: input.expiresAt,
        })),
        total: filteredCaseKeys.length,
        summary: {
          total: matching.length,
          proposedChanges: matching.filter((observation) => observation.changed).length,
          reviewRequired: matching.filter((observation) =>
            ["risky", "invalid", "unknown"].includes(observation.resultClass),
          ).length,
          averageDurationMs: average,
          p95DurationMs: durations[p95Index] ?? 0,
          assistShown: 0,
          assistApplied: 0,
          assistKept: 0,
          assistUndone: 0,
        },
      };
    },
    async deleteExpired(now) {
      const retained = observations.filter(
        (observation) => observation.expiresAt.getTime() > now.getTime(),
      );
      const deleted = observations.length - retained.length;
      observations.splice(0, observations.length, ...retained);
      return deleted;
    },
    async close() {},
  };
}

function matchedAddressSearcher(searched: string[]): AddressSearcher {
  return {
    async search(input) {
      searched.push(input);
      return {
        object: "address_search_result",
        status: "matched",
        input,
        normalized: "karlovo namesti 19 praha 2 12000",
        suggestions: [
          {
            id: "ruian-address-1",
            addressLine: "Karlovo náměstí 19/13, Nové Město, 120 00 Praha 2",
            municipality: "Praha",
            municipalityPart: "Praha 2",
            street: "Karlovo náměstí",
            houseNumber: "19",
            orientationNumber: "13",
            postalCode: "12000",
            matchScore: 0.98,
            reasons: ["address.all_tokens_match", "address.postal_code_match"],
          },
        ],
        evidence: {
          source: "ruian-st-uads",
          sourceVersion: "2026-08-01",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          state: "confirmed",
        },
      };
    },
    async close() {},
  };
}

function confirmedAresResult(input: string): AresLookupResult {
  return {
    object: "company_lookup_result",
    provider: "ares",
    input,
    normalized_ico: "00006947",
    lookup_state: "confirmed",
    status: "valid",
    recommended_action: "accept",
    company: {
      ico: "00006947",
      name: "Ministerstvo financí",
      vat_id: null,
      address: "Letenská 525/15, Praha",
      address_standardized: true,
      updated_at: "2026-08-16",
      primary_source: "res",
      registered_office: {
        street_line: "Letenská 525/15",
        city: "Praha",
        postal_code: "11800",
        country: "CZ",
      },
    },
    issues: [],
    evidence: [
      {
        source: "ares",
        checked_at: "2026-08-17T09:00:00.000Z",
        state: "confirmed",
        health: "available",
        detail: "company.ares_confirmed",
      },
    ],
  };
}
