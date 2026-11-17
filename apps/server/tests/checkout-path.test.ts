import type {
  IntegrationRecord,
  IntegrationState,
  IntegrationStore,
  PilotStore,
  RuntimeIntegration,
  RuntimeIntegrationConfig,
  ShadowObservationStore,
} from "@checkdrop/db";
import { describe, expect, it, vi } from "vitest";
import type { AresLookupResult } from "../src/providers/ares.js";
import { createApp } from "../src/app.js";
import { createPilotRateLimiter } from "../src/rate-limit.js";

const ORIGIN = "https://shop.example";
const SITE = "cdp_site_integration-1";
const SECRET = "embed-signing-secret-with-at-least-32-characters";
const SESSION_A = "12345678-1234-4234-8234-123456789abc";
const SESSION_B = "12345678-1234-4234-8234-123456789abd";
const SESSION_C = "12345678-1234-4234-8234-123456789abe";
const createdAt = new Date("2026-11-01T10:00:00.000Z");

const nameField = {
  id: "field-name",
  sourceSelector: "#billing-name",
  sourceLabel: "Jméno a příjmení",
  sourceName: "billing_name",
  canonicalField: "full_name",
  context: "billing",
  conditionKey: null,
  required: true,
  requireCompleteName: true,
  requireDomesticAddress: false,
  submitSelector: "#submit",
  validationMode: "suggest",
  validationTrigger: "blur",
  confidence: 100,
  detected: true,
} as const;

function integrationStore() {
  const current = { state: "shadow" as IntegrationState };
  const record = (): IntegrationRecord => ({
    id: "integration-1",
    projectRef: "project-a",
    name: "Shop",
    clientName: "example-shop",
    environment: "live",
    formUrl: `${ORIGIN}/checkout`,
    state: current.state,
    configVersion: 7,
    createdAt,
    updatedAt: createdAt,
    fields: [nameField],
    forms: [
      {
        id: "form-checkout",
        integrationId: "integration-1",
        name: "Pokladna",
        formUrl: `${ORIGIN}/checkout`,
        matchMode: "exact",
        pathPattern: "/checkout",
        rootSelector: "#checkout",
        state: "configured",
        configVersion: 4,
        isDefault: true,
        createdAt,
        updatedAt: createdAt,
        fields: [nameField],
      },
    ],
    apiKeys: [
      {
        id: "key-runtime",
        name: "Hosted script runtime",
        keyPrefix: "cdp_0123456789ab",
        environment: "live",
        state: "active",
        createdAt,
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
    activity: { lastKeyUsedAt: null, observationCount24h: 0, lastObservationAt: null },
  });
  const runtime = (): RuntimeIntegration => {
    const full = record();
    return {
      id: full.id,
      projectRef: full.projectRef,
      clientName: full.clientName,
      formUrl: full.formUrl,
      state: full.state,
      forms: full.forms.map(({ id, name, state, isDefault }) => ({ id, name, state, isDefault })),
      apiKeys: full.apiKeys,
    };
  };
  const config = (): RuntimeIntegrationConfig => {
    const full = record();
    return {
      id: full.id,
      projectRef: full.projectRef,
      clientName: full.clientName,
      environment: full.environment,
      state: full.state,
      configVersion: full.configVersion,
      forms: full.forms,
    };
  };
  const calls = {
    getRuntimeIntegrationById: vi.fn(async () => runtime()),
    getRuntimeConfigById: vi.fn(async () => config()),
    getIntegrationById: vi.fn(async () => record()),
    getIntegration: vi.fn(async () => record()),
    setState: vi.fn(async (_projectRef: string, _id: string, state: IntegrationState) => {
      current.state = state;
      return record();
    }),
  };
  return { current, calls, store: calls as unknown as IntegrationStore };
}

function pilotStore(recordUsage: PilotStore["recordUsage"] = async () => true): PilotStore {
  return {
    async findApiKeyByPrefix() {
      return null;
    },
    async createApiKey() {},
    recordUsage,
    async close() {},
  };
}

function observationStore(
  save: ShadowObservationStore["save"] = async () => true,
): ShadowObservationStore & { interactions: unknown[] } {
  const interactions: unknown[] = [];
  return {
    fullValuesEnabled: false,
    interactions,
    save,
    async recordAssistInteraction(input) {
      interactions.push(input);
      return true;
    },
    async list() {
      throw new Error("not used");
    },
    async deleteExpired() {
      return 0;
    },
    async close() {},
  };
}

function embedApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const integration = integrationStore();
  let clock = 0;
  const app = createApp({
    pilotStore: pilotStore(),
    integrationStore: integration.store,
    shadowObservationStore: observationStore(),
    checkoutEventStore: null,
    addressSearcher: null,
    adminAccountStore: null,
    instanceStatusStore: null,
    embedSigningSecret: SECRET,
    operatorToken: "operator-secret-value",
    operatorProjectRef: "project-a",
    monotonicNow: () => clock,
    ...overrides,
  });
  return {
    app,
    integration,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const config = (app: ReturnType<typeof createApp>, session = SESSION_A) =>
  app.request(`/v1/integration/config?site=${SITE}&path=%2Fcheckout&session=${session}`, {
    headers: { Origin: ORIGIN },
  });
const validateName = (
  app: ReturnType<typeof createApp>,
  session: string | null = SESSION_A,
  init: { readonly origin?: string; readonly contentType?: string } = {},
) =>
  app.request(
    `/v1/names/validate?site=${SITE}&form=form-checkout${session ? `&session=${session}` : ""}`,
    {
      method: "POST",
      headers: {
        Origin: init.origin ?? ORIGIN,
        "Content-Type": init.contentType ?? "application/json",
      },
      body: JSON.stringify({ full_name: "Jana Nováková" }),
    },
  );

async function configBody(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  delete body.request_id;
  return body;
}

describe("runtime integration cache", () => {
  it("serves config, preflights and checks from one load per integration", async () => {
    const { app, integration } = embedApp();
    const first = await config(app);
    expect(first.status).toBe(200);
    const second = await config(app);
    const preflight = await app.request(`/v1/names/validate?site=${SITE}&session=${SESSION_A}`, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect((await validateName(app)).status).toBe(200);
    expect(await configBody(second)).toEqual(await configBody(first));
    expect(integration.calls.getRuntimeIntegrationById).toHaveBeenCalledTimes(1);
    expect(integration.calls.getRuntimeConfigById).toHaveBeenCalledTimes(1);
    expect(integration.calls.getIntegration).not.toHaveBeenCalled();
  });

  it("answers the lean config byte-for-byte like the full integration record", async () => {
    const lean = embedApp({ randomId: () => "id" });
    const legacy = integrationStore();
    const { getRuntimeConfigById: _lean, ...withoutLean } = legacy.calls;
    const full = embedApp({
      randomId: () => "id",
      integrationStore: withoutLean as unknown as IntegrationStore,
    });
    const leanBody = await configBody(await config(lean.app));
    expect(leanBody).toMatchObject({
      state: "shadow",
      config_version: 4,
      form: { id: "form-checkout", root_selector: "#checkout" },
      fields: [{ selector: "#billing-name", submit_selector: "#submit" }],
      forms: [{ id: "form-checkout" }],
    });
    expect(JSON.stringify(leanBody)).toBe(JSON.stringify(await configBody(await config(full.app))));
    expect(legacy.calls.getIntegrationById).toHaveBeenCalledTimes(1);
  });

  it("drops cached entries when an operator route changes the integration", async () => {
    const { app, integration } = embedApp();
    expect((await config(app)).status).toBe(200);
    const paused = await app.request("/v1/operator/integrations/integration-1/state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Checkdrop-Operator-Key": "operator-secret-value",
      },
      body: JSON.stringify({ state: "paused" }),
    });
    expect(paused.status).toBe(200);
    expect(integration.calls.setState).toHaveBeenCalledTimes(1);
    expect((await config(app)).status).toBe(403);
    expect((await validateName(app)).status).toBe(403);
    expect(integration.calls.getRuntimeIntegrationById).toHaveBeenCalledTimes(2);
  });

  it("re-reads a change made by another process once the 30 s lifetime ends", async () => {
    const { app, integration, advance } = embedApp();
    expect((await config(app)).status).toBe(200);
    integration.current.state = "paused";
    advance(29_000);
    expect((await config(app)).status).toBe(200);
    advance(1_001);
    expect((await config(app)).status).toBe(403);
  });

  it("never caches a failed read", async () => {
    const { app, integration } = embedApp();
    integration.calls.getRuntimeIntegrationById.mockRejectedValueOnce(new Error("database down"));
    expect((await config(app)).status).toBe(503);
    expect((await config(app)).status).toBe(200);
  });
});

describe("hosted script rate limits", () => {
  const limiter = () =>
    createPilotRateLimiter({ embedSessionLimit: 2, embedSiteLimit: 3, now: () => 1_000 });

  it("budgets each checkout session under a site-wide ceiling", async () => {
    const { app } = embedApp({ rateLimiter: limiter() });
    expect((await validateName(app, SESSION_A)).status).toBe(200);
    expect((await validateName(app, SESSION_A)).status).toBe(200);
    const throttled = await validateName(app, SESSION_A);
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBe("60");
    // The browser can read the 429 and its Retry-After only with these CORS headers.
    expect(throttled.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(throttled.headers.get("Access-Control-Expose-Headers")).toBe("Retry-After");
    expect((await validateName(app, SESSION_B)).status).toBe(200);
    // Three allowed requests reached the site ceiling; a fresh session is stopped too.
    expect((await validateName(app, SESSION_C)).status).toBe(429);
  });

  it("shares one budget per site for requests without a session", async () => {
    const { app } = embedApp({ rateLimiter: limiter() });
    expect((await validateName(app, null)).status).toBe(200);
    expect((await validateName(app, null)).status).toBe(200);
    expect((await validateName(app, null)).status).toBe(429);
    expect((await validateName(app, SESSION_A)).status).toBe(200);
  });

  it("counts neither preflights nor assist interactions against the checks", async () => {
    const observations = observationStore();
    const { app } = embedApp({ rateLimiter: limiter(), shadowObservationStore: observations });
    for (let index = 0; index < 5; index += 1) {
      const preflight = await app.request(`/v1/names/validate?site=${SITE}&session=${SESSION_A}`, {
        method: "OPTIONS",
        headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
      });
      expect(preflight.status).toBe(204);
    }
    const interaction = () =>
      app.request(`/v1/assist/interactions?site=${SITE}&form=form-checkout&session=${SESSION_A}`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          request_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
          event: "shown",
        }),
      });
    expect((await interaction()).status).toBe(204);
    expect((await interaction()).status).toBe(204);
    expect(observations.interactions).toHaveLength(2);
    expect((await validateName(app)).status).toBe(200);
    expect((await validateName(app)).status).toBe(200);
    expect((await validateName(app)).status).toBe(429);
  });

  it("keeps a denied session from using up the site ceiling", () => {
    const rateLimiter = limiter();
    for (let index = 0; index < 10; index += 1)
      rateLimiter.consumeEmbed("site", "session-a", "validation");
    // Only session A's two allowed requests count, so one more session still fits under 3.
    expect(rateLimiter.consumeEmbed("site", "session-b", "validation").allowed).toBe(true);
    expect(rateLimiter.consumeEmbed("site", "session-c", "validation").allowed).toBe(false);
    // Other kinds of request have their own budgets.
    expect(rateLimiter.consumeEmbed("site", "session-a", "checkout").allowed).toBe(true);
    expect(rateLimiter.consumeEmbed("site", "session-a", "assist").allowed).toBe(true);
  });
});

describe("preflight-free JSON from the hosted script", () => {
  it("accepts text/plain JSON only after the embed origin check", async () => {
    const recordUsage = vi.fn(async () => true);
    const { app } = embedApp({ pilotStore: pilotStore(recordUsage) });
    const accepted = await validateName(app, SESSION_A, {
      contentType: "text/plain;charset=UTF-8",
    });
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    await expect(accepted.json()).resolves.toMatchObject({ object: "validation_result" });
    const foreign = await validateName(app, SESSION_A, {
      origin: "https://attacker.example",
      contentType: "text/plain;charset=UTF-8",
    });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const withoutOrigin = await app.request(
      `/v1/names/validate?site=${SITE}&form=form-checkout&session=${SESSION_A}`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ full_name: "Jana Nováková" }),
      },
    );
    expect(withoutOrigin.status).toBe(403);
    const otherType = await validateName(app, SESSION_A, {
      contentType: "application/x-www-form-urlencoded",
    });
    expect(otherType.status).toBe(415);
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });
});

describe("validation writes", () => {
  it("records usage and the observation together and keeps the usage error", async () => {
    let finishUsage: (value: boolean) => void = () => undefined;
    const recordUsage = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishUsage = resolve;
        }),
    );
    const save = vi.fn(async () => true);
    const { app } = embedApp({
      pilotStore: pilotStore(recordUsage),
      shadowObservationStore: observationStore(save),
    });
    const pending = validateName(app);
    await vi.waitFor(() => expect(recordUsage).toHaveBeenCalledTimes(1));
    // The observation is written while usage is still in flight.
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    finishUsage(true);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Checkdrop-Observation")).toBe("stored");

    recordUsage.mockImplementationOnce(async () => {
      throw new Error("database down");
    });
    const failed = await validateName(app);
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({
      detail: "Usage recording is temporarily unavailable.",
    });
  });
});

describe("IČO validation cache", () => {
  const aresResult = (lookupState: AresLookupResult["lookup_state"]): AresLookupResult => ({
    object: "company_lookup_result",
    provider: "ares",
    input: "27074358",
    normalized_ico: "27074358",
    lookup_state: lookupState,
    status: lookupState === "confirmed" ? "valid" : "unknown",
    recommended_action: lookupState === "confirmed" ? "accept" : "fail_open",
    company:
      lookupState === "confirmed"
        ? ({ ico: "27074358", name: "Example s.r.o." } as AresLookupResult["company"])
        : null,
    issues: [],
    evidence: [
      {
        source: "ares",
        checked_at: "2026-11-01T10:00:00.000Z",
        state: lookupState,
        health: "available",
      },
    ],
  });
  async function validateIco(app: ReturnType<typeof createApp>, companyId: string) {
    const response = await app.request(`/v1/company-ids/validate?site=${SITE}&form=form-checkout`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, country: "CZ" }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { status: string; normalized: string | null };
  }

  it.each([
    ["confirmed", 6 * 60 * 60_000],
    ["not_found", 5 * 60_000],
    ["unavailable", 10_000],
  ] as const)("keeps a %s answer for its lifetime", async (lookupState, ttlMs) => {
    const lookupAres = vi.fn(async () => aresResult(lookupState));
    const { app, advance } = embedApp({ lookupAres });
    await validateIco(app, "27074358");
    const repeated = await validateIco(app, " 270 743 58 ");
    expect(lookupAres).toHaveBeenCalledTimes(1);
    if (lookupState === "confirmed") expect(repeated.status).toBe("correctable");
    advance(ttlMs - 1);
    await validateIco(app, "27074358");
    expect(lookupAres).toHaveBeenCalledTimes(1);
    advance(2);
    await validateIco(app, "27074358");
    expect(lookupAres).toHaveBeenCalledTimes(2);
  });

  it("does not cache a thrown ARES error", async () => {
    const lookupAres = vi
      .fn<(input: string) => Promise<AresLookupResult>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(aresResult("confirmed"));
    const { app } = embedApp({ lookupAres });
    expect((await validateIco(app, "27074358")).status).toBe("unknown");
    expect((await validateIco(app, "27074358")).status).toBe("valid");
    expect(lookupAres).toHaveBeenCalledTimes(2);
  });
});
