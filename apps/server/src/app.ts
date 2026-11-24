import { createHmac, randomUUID } from "node:crypto";
import { CHECKDROP_CORE_VERSION, validateEmail, validatePersonName } from "@checkdrop/core";
import {
  type AddressSearcher,
  type AdminAccountStore,
  type CheckoutEventStore,
  createAdminAccountStore,
  createInstanceStatusStore,
  createPostgresAddressSearcher,
  createPostgresCheckoutEventStore,
  createPostgresIntegrationStore,
  createPostgresPilotStore,
  createPostgresShadowObservationStore,
  type InstanceStatusStore,
  type IntegrationStore,
  type PilotApiKeyRecord,
  type PilotStore,
  type RuntimeIntegration,
  type RuntimeIntegrationConfig,
  type ShadowObservationAction,
  type ShadowObservationOperation,
  type ShadowObservationStatus,
  type ShadowObservationStore,
  selectIntegrationForms,
} from "@checkdrop/db";
import { type Context, Hono } from "hono";
import { requestId } from "hono/request-id";
import { registerAdminAuthRoutes } from "./admin-auth.js";
import { extractApiKeyPrefix, hashIdempotencyKey, verifyApiKey } from "./api-key.js";
import {
  countryPacks,
  defaultCountryPack,
  resolveCountryPack,
  supportedCountriesText,
} from "./country-packs.js";
import { lookupEmailDns } from "./dns.js";
import { createCachedEmailDnsLookup } from "./email-dns-cache.js";
import { type EmbedAsset, loadEmbedAsset } from "./embed-asset.js";
import { type InstanceConfig, PROBLEM_TYPE_BASE, readInstanceConfig } from "./instance-config.js";
import { readUpdateState, type UpdateState } from "./instance-state.js";
import { registerOperatorIntegrationRoutes } from "./operator-integrations.js";
import {
  type AresAutocompleteResult,
  type AresCompany,
  type AresLookupResult,
  lookupAresCompany,
  searchAresCompanies,
} from "./providers/ares.js";
import { BoundedMap, createLiveLookup } from "./providers/live-lookup.js";
import {
  createPilotRateLimiter,
  type EmbedRateLimitBucket,
  type PilotRateLimiter,
  type RateLimitDecision,
} from "./rate-limit.js";
import { measureRequestPhase, type RequestTiming, requestTiming } from "./request-timing.js";
import { classifyRuianAddress } from "./ruian-address-audit.js";

const MAX_VALIDATION_BODY_BYTES = 8_192;
// Checkout page loads and every hosted check read the same integration. Writes made through the
// operator routes of this process clear it at once; other processes see a change within the TTL.
const DEFAULT_RUNTIME_CACHE_TTL_MS = 30_000;
const RUNTIME_CACHE_MAX_ENTRIES = 1_000;
const ARES_CONFIRMED_TTL_MS = 6 * 60 * 60_000;
const ARES_NOT_FOUND_TTL_MS = 5 * 60_000;
const ARES_UNAVAILABLE_TTL_MS = 10_000;
const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };
const SHADOW_OBSERVATION_RETENTION_HOURS = 90 * 24;
const SHADOW_OBSERVATION_RETENTION_MS = SHADOW_OBSERVATION_RETENTION_HOURS * 60 * 60 * 1_000;
const EMBED_PATHS = new Set([
  "/v1/integration/config",
  "/v1/assist/interactions",
  "/v1/checkout/events",
  "/v1/names/validate",
  "/v1/emails/validate",
  "/v1/phones/validate",
  "/v1/addresses/validate",
  "/v1/addresses/autocomplete",
  "/v1/company-ids/validate",
  "/v1/companies/autocomplete",
]);

type EmailDnsLookup = typeof lookupEmailDns;
type AresLookup = (input: string) => Promise<AresLookupResult>;
type AresSearch = (input: string, limit: number) => Promise<AresAutocompleteResult>;

export interface AppDependencies {
  /** Administrator accounts; null disables the sign-in routes (no database). */
  readonly adminAccountStore?: AdminAccountStore | null;
  readonly instanceConfig?: InstanceConfig;
  readonly adminSetupCode?: string | null;
  readonly instanceStatusStore?: InstanceStatusStore | null;
  readonly readUpdateState?: () => Promise<UpdateState | null>;
  readonly customerAuthorizer?: Parameters<
    typeof registerOperatorIntegrationRoutes
  >[1]["customerAuthorizer"];
  readonly checkoutEventStore?: CheckoutEventStore | null;
  readonly onRequestTiming?: (value: RequestTiming) => void;
  readonly pilotStore?: PilotStore | null;
  readonly shadowObservationStore?: ShadowObservationStore | null;
  readonly addressSearcher?: AddressSearcher | null;
  readonly integrationStore?: IntegrationStore | null;
  readonly operatorToken?: string | null;
  readonly operatorProjectRef?: string | null;
  readonly embedSigningSecret?: string | null;
  readonly observationEncryptionKey?: string | null;
  readonly scanForm?: Parameters<typeof registerOperatorIntegrationRoutes>[1]["scanForm"];
  readonly lookupDns?: EmailDnsLookup;
  readonly embedAsset?: EmbedAsset;
  readonly lookupAres?: AresLookup;
  readonly searchAres?: AresSearch;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly randomId?: () => string;
  readonly rateLimiter?: PilotRateLimiter;
  /** Lifetime of cached runtime integrations; 0 reads the store on every request. */
  readonly runtimeCacheTtlMs?: number;
}

interface AuthenticatedRequest {
  readonly apiKey: PilotApiKeyRecord;
  readonly rawKey: string;
  readonly trustedClientMetadata?: ClientMetadata;
  /** Set for hosted-script requests, whose budget is counted per checkout session at sign-in. */
  readonly embed?: true;
}

interface EmbedRuntime {
  integration(id: string): Promise<RuntimeIntegration | null>;
  config(id: string): Promise<RuntimeIntegrationConfig | null>;
}

interface RuntimeCache<Value> {
  get(key: string, load: () => Promise<Value>): Promise<Value>;
  invalidate(key: string): void;
}

/**
 * Small TTL cache with one shared load per key. An invalidation also discards a load that is still
 * running, so an answer read before a write is never stored after it. Errors are never cached.
 */
function createRuntimeCache<Value>(ttlMs: number, now: () => number): RuntimeCache<Value> {
  const entries = new BoundedMap<string, { readonly expiresAt: number; readonly value: Value }>(
    RUNTIME_CACHE_MAX_ENTRIES,
  );
  const loads = new Map<string, { stale: boolean; promise: Promise<Value> }>();
  return {
    get(key, load) {
      if (ttlMs <= 0) return load();
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now()) return Promise.resolve(cached.value);
      const running = loads.get(key);
      if (running) return running.promise;
      const flight = { stale: false, promise: Promise.resolve() as Promise<Value> };
      flight.promise = load()
        .then((value) => {
          if (!flight.stale) entries.set(key, { expiresAt: now() + ttlMs, value });
          return value;
        })
        .finally(() => {
          if (loads.get(key) === flight) loads.delete(key);
        });
      loads.set(key, flight);
      return flight.promise;
    },
    invalidate(key) {
      entries.delete(key);
      const running = loads.get(key);
      if (running) running.stale = true;
      loads.delete(key);
    },
  };
}

const INTEGRATION_WRITES_BY_ARGUMENT = new Set<string | symbol>([
  "setFormRootSelector",
  "replaceFormFields",
  "setFormState",
  "replaceFields",
  "setState",
  "createApiKey",
  "revokeApiKey",
  "rollbackConfigVersion",
  "rollbackFormConfigVersion",
]);
const INTEGRATION_WRITES_BY_INPUT = new Set<string | symbol>([
  "createIntegration",
  "createForm",
  "saveFormScan",
]);

/** Clears the runtime caches after every integration write, whether it succeeds or fails. */
function invalidatingIntegrationStore(
  store: IntegrationStore,
  invalidate: (integrationId: string) => void,
): IntegrationStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const byArgument = INTEGRATION_WRITES_BY_ARGUMENT.has(property);
      if (!byArgument && !INTEGRATION_WRITES_BY_INPUT.has(property)) return value.bind(target);
      return async (...args: unknown[]) => {
        const input = args[0] as { readonly id?: unknown; readonly integrationId?: unknown };
        const integrationId = byArgument ? args[1] : (input.integrationId ?? input.id);
        try {
          return await value.apply(target, args);
        } finally {
          if (typeof integrationId === "string") invalidate(integrationId);
        }
      };
    },
  });
}

interface ClientMetadata {
  readonly integrationMode: "api" | "shadow";
  readonly clientName: string | null;
  readonly observationMode: "none" | "preview";
  readonly formId?: string | null;
  readonly formName?: string | null;
  readonly checkoutSessionRef?: string | null;
}

interface ValidationEnvelope {
  readonly id: string;
  readonly object: "validation_result";
  readonly request_id: string;
  readonly status: string;
  readonly action: string;
  readonly normalized: string | null;
  readonly suggestion: string | null;
  readonly issues: readonly unknown[];
  readonly evidence: readonly unknown[];
  readonly company?: AresCompany | null;
}

type ValidationPayload = Omit<ValidationEnvelope, "id" | "object" | "request_id">;

type AddressAdviceResponse =
  | {
      readonly code:
        | "address.house_number_missing"
        | "address.no_match"
        | "address.country_mismatch";
    }
  | { readonly code: "address.postal_code_mismatch"; readonly postal_code: string };

interface AddressAutocompleteEnvelope {
  readonly advice?: AddressAdviceResponse;
  readonly object: "address_suggestion_list";
  readonly request_id: string;
  readonly status: "matched" | "no_match" | "unavailable";
  readonly country: "CZ";
  readonly suggestions: readonly {
    readonly id: string;
    readonly label: string;
    readonly street_line: string;
    readonly street: string | null;
    readonly house_number: string;
    readonly orientation_number: string | null;
    readonly city: string;
    readonly city_part: string | null;
    readonly postal_code: string;
  }[];
  readonly evidence: readonly {
    readonly source: "ruian";
    readonly checked_at: string;
    readonly state: "confirmed" | "absent" | "unavailable";
    readonly detail: string;
  }[];
}

interface CompanyAutocompleteEnvelope {
  readonly object: "company_suggestion_list";
  readonly request_id: string;
  readonly status: "matched" | "no_match" | "unavailable";
  readonly country: "CZ";
  readonly suggestions: readonly AresCompany[];
  readonly evidence: readonly unknown[];
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = new Hono();
  const now = dependencies.now ?? (() => new Date());
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const randomId = dependencies.randomId ?? randomUUID;
  // One bounded cache per app instance; it is never shared between instances or tests.
  const lookupDns = createCachedEmailDnsLookup(dependencies.lookupDns ?? lookupEmailDns);
  const lookupAresDirect =
    dependencies.lookupAres ?? ((input: string) => lookupAresCompany(input, { timeoutMs: 2_500 }));
  // IČO answers change rarely; an outage is kept only briefly, like company search below.
  const lookupAres = createLiveLookup(
    lookupAresDirect,
    (input: string) => input.replace(/\s+/g, ""),
    {
      now: () => monotonicNow(),
      ttlMs: (result) =>
        result.lookup_state === "confirmed"
          ? ARES_CONFIRMED_TTL_MS
          : result.lookup_state === "not_found"
            ? ARES_NOT_FOUND_TTL_MS
            : result.lookup_state === "invalid_input"
              ? 0
              : ARES_UNAVAILABLE_TTL_MS,
      maxEntries: 2_000,
      maxInFlight: 32,
      // Thrown, so the IČO check answers "unavailable" at once instead of queueing.
      whenBusy: () => {
        throw new Error("ARES lookup capacity is exhausted.");
      },
    },
  );
  const searchAres =
    dependencies.searchAres ??
    ((input: string, limit: number) => searchAresCompanies(input, limit, { timeoutMs: 2_500 }));
  const unavailableCompanySearch = (query: string): AresAutocompleteResult => ({
    object: "company_suggestion_list",
    provider: "ares",
    input: query,
    status: "unavailable",
    companies: [],
    issues: ["company.ares_unavailable"],
    evidence: [],
  });
  // An ARES outage is kept only briefly, so suggestions return soon after ARES recovers.
  const searchCompanies = createLiveLookup(
    async (query: string, limit: number) => {
      try {
        return await searchAres(query, limit);
      } catch {
        return unavailableCompanySearch(query);
      }
    },
    (query, limit) => `${query.toLocaleLowerCase("cs-CZ")}:${limit}`,
    {
      now: () => now().getTime(),
      ttlMs: (result) => (result.status === "unavailable" ? 10_000 : 5 * 60_000),
      maxEntries: 500,
      maxInFlight: 32,
      whenBusy: (query) => unavailableCompanySearch(query),
    },
  );
  // Companies seen in ARES answers, used for IČO prefix suggestions without another request.
  const knownCompanies = new BoundedMap<string, AresCompany>(5_000);
  const pilotStore = resolvePilotStore(dependencies);
  const observationEncryptionKey =
    dependencies.observationEncryptionKey ??
    process.env.CHECKDROP_OBSERVATION_ENCRYPTION_KEY ??
    null;
  const shadowObservationStore = resolveShadowObservationStore(
    dependencies,
    observationEncryptionKey,
  );
  const addressSearcher = resolveAddressSearcher(dependencies);
  const integrationStore = resolveIntegrationStore(dependencies);
  const runtimeCacheTtlMs = dependencies.runtimeCacheTtlMs ?? DEFAULT_RUNTIME_CACHE_TTL_MS;
  const runtimeIntegrations = createRuntimeCache<RuntimeIntegration | null>(
    runtimeCacheTtlMs,
    monotonicNow,
  );
  const runtimeConfigs = createRuntimeCache<RuntimeIntegrationConfig | null>(
    runtimeCacheTtlMs,
    monotonicNow,
  );
  const runtime: EmbedRuntime | null = integrationStore
    ? {
        integration: (id) =>
          runtimeIntegrations.get(id, () =>
            integrationStore.getRuntimeIntegrationById
              ? integrationStore.getRuntimeIntegrationById(id)
              : integrationStore.getIntegrationById(id),
          ),
        config: (id) =>
          runtimeConfigs.get(id, () =>
            integrationStore.getRuntimeConfigById
              ? integrationStore.getRuntimeConfigById(id)
              : integrationStore.getIntegrationById(id),
          ),
      }
    : null;
  const invalidateRuntimeIntegration = (integrationId: string) => {
    runtimeIntegrations.invalidate(integrationId);
    runtimeConfigs.invalidate(integrationId);
  };
  const checkoutEventStore =
    dependencies.checkoutEventStore !== undefined
      ? dependencies.checkoutEventStore
      : process.env.CHECKDROP_DATABASE_URL
        ? createPostgresCheckoutEventStore(process.env.CHECKDROP_DATABASE_URL)
        : null;
  const rateLimiter = dependencies.rateLimiter ?? createPilotRateLimiter();
  const embedAsset = dependencies.embedAsset ?? loadEmbedAsset();
  const instanceConfig = dependencies.instanceConfig ?? readInstanceConfig();
  const adminAccountStore =
    dependencies.adminAccountStore !== undefined
      ? dependencies.adminAccountStore
      : process.env.CHECKDROP_DATABASE_URL
        ? createAdminAccountStore(process.env.CHECKDROP_DATABASE_URL)
        : null;
  const embedETag = `"${embedAsset.sha256.slice(0, 32)}"`;
  const embedSigningSecret =
    dependencies.embedSigningSecret ?? process.env.CHECKDROP_EMBED_SIGNING_SECRET ?? null;
  const authenticateValidation = (context: Context) =>
    measureRequestPhase(context, "auth", () =>
      authenticateValidationRequest(context, pilotStore, runtime, embedSigningSecret, rateLimiter),
    );

  app.use("*", requestId({ limitLength: 0 }));
  app.use(
    "/v1/*",
    requestTiming(() => performance.now(), dependencies.onRequestTiming),
  );

  if (instanceConfig.adminAuthMode === "password" && adminAccountStore) {
    registerAdminAuthRoutes(app, {
      store: adminAccountStore,
      adminOrigin: instanceConfig.publicAdminUrl,
      setupCode:
        dependencies.adminSetupCode !== undefined
          ? dependencies.adminSetupCode
          : (process.env.CHECKDROP_ADMIN_SETUP_CODE ?? null),
      now,
    });
  }

  app.get("/v1/embed.js", (context) => {
    const headers = {
      // Five minutes keeps releases and rollbacks fast. A browser may run a stale copy for at most
      // five more minutes while it revalidates, so a new check (such as a required phone) is in
      // force within ten minutes of a release. Only an origin failure allows a day-old copy, so a
      // checkout never loses assistance because of a short outage.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=300, stale-if-error=86400",
      "Content-Type": "application/javascript; charset=utf-8",
      "Cross-Origin-Resource-Policy": "cross-origin",
      ETag: embedETag,
      "X-Content-Type-Options": "nosniff",
    };
    const ifNoneMatch = context.req.header("If-None-Match") ?? "";
    if (ifNoneMatch.split(",").some((tag) => tag.trim() === embedETag || tag.trim() === "*"))
      return context.body(null, 304, headers);
    return context.body(embedAsset.body, 200, headers);
  });

  app.options("/v1/*", async (context) => {
    if (!context.req.query("site") || !EMBED_PATHS.has(context.req.path)) {
      return problem(
        context,
        404,
        "Resource not found",
        "The requested embed resource does not exist.",
      );
    }
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    const method = context.req.path === "/v1/integration/config" ? "GET" : "POST";
    return context.body(null, 204, {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": method,
      "Access-Control-Max-Age": "600",
      "Cache-Control": "no-store",
    });
  });

  registerOperatorIntegrationRoutes(app, {
    ...(dependencies.customerAuthorizer
      ? { customerAuthorizer: dependencies.customerAuthorizer }
      : {}),
    store: integrationStore
      ? invalidatingIntegrationStore(integrationStore, invalidateRuntimeIntegration)
      : null,
    observationStore: shadowObservationStore,
    checkoutEventStore,
    operatorToken: dependencies.operatorToken ?? process.env.CHECKDROP_OPERATOR_TOKEN ?? null,
    projectRef:
      dependencies.operatorProjectRef ?? process.env.CHECKDROP_OPERATOR_PROJECT_REF ?? null,
    ...(dependencies.scanForm ? { scanForm: dependencies.scanForm } : {}),
    instance: {
      release: process.env.CHECKDROP_RELEASE ?? "dev",
      adminAuthMode: instanceConfig.adminAuthMode,
      status:
        dependencies.instanceStatusStore !== undefined
          ? dependencies.instanceStatusStore
          : process.env.CHECKDROP_DATABASE_URL
            ? createInstanceStatusStore(process.env.CHECKDROP_DATABASE_URL)
            : null,
      readUpdateState: dependencies.readUpdateState ?? (() => readUpdateState()),
    },
    now,
    randomId,
  });

  app.get("/v1/health", (context) =>
    context.json({
      object: "health_status",
      status: "ok",
      service: "checkdrop-server",
      request_id: context.get("requestId"),
      version: CHECKDROP_CORE_VERSION,
      release: process.env.CHECKDROP_RELEASE ?? null,
    }),
  );

  app.get("/v1/capabilities", (context) =>
    context.json({
      object: "capability_list",
      request_id: context.get("requestId"),
      country_packs: [...countryPacks.values()].map((pack) => pack.manifest),
      internal_api: {
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
      },
      shadow_pilot: {
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
        stores_raw_input: shadowObservationStore?.fullValuesEnabled ?? false,
        preview_retention_hours: SHADOW_OBSERVATION_RETENTION_HOURS,
      },
    }),
  );

  app.get("/v1/integration/config", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    if (!runtime || !authenticated.apiKey.integrationId) {
      return problem(
        context,
        404,
        "Integration config not found",
        "This API key is not linked to a configured integration.",
      );
    }
    let integration: RuntimeIntegrationConfig | null;
    try {
      const loaded = await runtime.config(authenticated.apiKey.integrationId);
      integration = loaded?.projectRef === authenticated.apiKey.projectRef ? loaded : null;
    } catch {
      return problem(
        context,
        503,
        "Internal API unavailable",
        "Integration configuration is temporarily unavailable.",
      );
    }
    if (!integration) {
      return problem(
        context,
        404,
        "Integration config not found",
        "This API key is not linked to a configured integration.",
      );
    }
    const requestedPath = context.req.query("path") ?? null;
    const forms = selectIntegrationForms(integration, requestedPath);
    const form = forms[0] ?? null;
    if (!form) {
      return context.json(
        {
          object: "integration_config",
          request_id: context.get("requestId"),
          integration_id: integration.id,
          client_name: integration.clientName,
          environment: authenticated.apiKey.environment ?? integration.environment,
          state: "unmatched",
          config_version: integration.configVersion,
          form: null,
          fields: [],
          forms: [],
        },
        200,
        { "Cache-Control": "no-store" },
      );
    }
    const serializedForms = forms.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      path_pattern: candidate.pathPattern,
      match_mode: candidate.matchMode,
      root_selector: candidate.rootSelector,
      config_version: candidate.configVersion,
      fields: candidate.fields.map((field) => ({
        selector: field.sourceSelector,
        canonical_field: field.canonicalField,
        context: field.context,
        condition_key: field.conditionKey,
        required: field.required,
        require_complete_name: field.requireCompleteName ?? false,
        require_domestic_address: field.requireDomesticAddress ?? false,
        require_valid_phone: field.requireValidPhone ?? false,
        submit_selector: field.submitSelector ?? null,
        validation_mode: field.validationMode,
        validation_trigger: field.validationTrigger,
      })),
    }));
    return context.json(
      {
        object: "integration_config",
        request_id: context.get("requestId"),
        integration_id: integration.id,
        client_name: integration.clientName,
        environment: authenticated.apiKey.environment ?? integration.environment,
        state: integration.state,
        config_version: form.configVersion,
        // Additive capability flags; the hosted script keeps the legacy payload when one is missing.
        features: { address_components: true },
        form: {
          id: form.id,
          name: form.name,
          path_pattern: form.pathPattern,
          match_mode: form.matchMode,
          root_selector: form.rootSelector,
        },
        fields: form.fields.map((field) => ({
          selector: field.sourceSelector,
          canonical_field: field.canonicalField,
          context: field.context,
          condition_key: field.conditionKey,
          required: field.required,
          require_complete_name: field.requireCompleteName ?? false,
          require_domestic_address: field.requireDomesticAddress ?? false,
          require_valid_phone: field.requireValidPhone ?? false,
          submit_selector: field.submitSelector ?? null,
          validation_mode: field.validationMode,
          validation_trigger: field.validationTrigger,
        })),
        forms: serializedForms,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  app.post("/v1/companies/autocomplete", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    const clientMetadata = resolveValidationClientMetadata(context, authenticated);
    if (clientMetadata instanceof Response) return clientMetadata;
    const validationLimit = consumeValidationLimit(rateLimiter, authenticated);
    if (!validationLimit.allowed) return rateLimited(context, validationLimit);
    const body = await readJsonObject(context, authenticated);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["query", "country", "limit"])) {
      return problem(context, 400, "Invalid request", "Request body contains unsupported fields.");
    }
    if (typeof body.query !== "string" || body.query.trim().length < 3 || body.query.length > 128) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'query' must contain 3–128 characters.",
      );
    }
    const countryPack = resolveCountryPack(body.country);
    if (!countryPack) return unsupportedCountry(context);
    const limit = Number.isInteger(body.limit) ? Math.min(5, Math.max(1, Number(body.limit))) : 5;
    const query = body.query.normalize("NFC").trim().replace(/\s+/g, " ");
    const cacheKey = `${query.toLocaleLowerCase("cs-CZ")}:${limit}`;
    let result: AresAutocompleteResult;
    const startedAt = monotonicNow();
    if (/^\d{3,7}$/.test(query)) {
      const companies = [...knownCompanies.values()]
        .filter((company) => company.ico.startsWith(query))
        .slice(0, limit);
      result = {
        object: "company_suggestion_list",
        provider: "ares",
        input: query,
        status: companies.length ? "matched" : "no_match",
        companies,
        issues: [],
        evidence: [],
      };
    } else {
      result = await searchCompanies(query, limit);
      for (const company of result.companies) knownCompanies.set(company.ico, company);
    }
    const durationMs = elapsedMilliseconds(startedAt, monotonicNow());
    const usageFailure = await recordUsage(
      context,
      pilotStore,
      authenticated.apiKey,
      "company.autocomplete",
      result.status,
      hashIdempotencyKey(authenticated.rawKey, `company.autocomplete:${cacheKey}`),
      clientMetadata,
      durationMs,
      now,
      randomId,
    );
    if (usageFailure) return usageFailure;
    return noStoreJson(
      context,
      {
        object: "company_suggestion_list",
        request_id: context.get("requestId"),
        status: result.status,
        country: "CZ",
        suggestions: result.companies,
        evidence: result.evidence,
      },
      durationMs,
    );
  });

  app.post("/v1/checkout/events", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    const metadata = authenticated.trustedClientMetadata;
    if (!metadata?.formId || !metadata.checkoutSessionRef || !authenticated.apiKey.integrationId)
      return problem(context, 403, "Forbidden", "Hosted checkout session required.");
    const body = await readJsonObject(context, authenticated);
    if (body instanceof Response) return body;
    if (
      !hasOnlyKeys(body, [
        "event_id",
        "event",
        "source",
        "reason",
        "field",
        "context",
        "order_ref",
        "purchase_channel",
      ]) ||
      (body.event === "purchase_reported"
        ? typeof body.order_ref !== "string" ||
          !/^[A-Za-z0-9_-]{1,80}$/.test(body.order_ref) ||
          !["b2c", "b2b"].includes(String(body.purchase_channel)) ||
          body.reason !== "none" ||
          body.field !== "none" ||
          body.context !== "none"
        : body.order_ref !== undefined || body.purchase_channel !== undefined) ||
      typeof body.event_id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        body.event_id,
      ) ||
      ![
        "started",
        "activity",
        "submit_attempt",
        "blocked",
        "submit_dispatched",
        "page_left",
        "purchase_reported",
      ].includes(String(body.event)) ||
      !["customer", "test"].includes(String(body.source)) ||
      ![
        "none",
        "checkdrop_name",
        "checkdrop_foreign_address",
        "checkdrop_phone",
        "native_required",
        "native_format",
        "shop_validation",
        "shop_cancelled",
      ].includes(String(body.reason)) ||
      ![
        "none",
        "full_name",
        "first_name",
        "last_name",
        "email",
        "phone",
        "street_line",
        "city",
        "postal_code",
        "country",
        "company_id",
        "company_name",
        "vat_id",
        "unmapped",
      ].includes(String(body.field)) ||
      !["none", "billing", "shipping", "company", "shared"].includes(String(body.context))
    )
      return problem(context, 400, "Invalid request", "Unsupported checkout event.");
    if (!checkoutEventStore)
      return problem(context, 503, "Unavailable", "Checkout measurement unavailable.");
    try {
      await checkoutEventStore.record({
        projectRef: authenticated.apiKey.projectRef,
        integrationId: authenticated.apiKey.integrationId,
        formId: metadata.formId,
        sessionRef: metadata.checkoutSessionRef,
        eventId: body.event_id,
        event: String(body.event),
        source: body.source as "customer" | "test",
        reason: String(body.reason),
        field: String(body.field),
        context: String(body.context),
        ...(body.event === "purchase_reported" && embedSigningSecret
          ? {
              orderRef: createHmac("sha256", embedSigningSecret)
                .update(
                  `purchase:${authenticated.apiKey.integrationId}:${body.source}:${body.order_ref}`,
                )
                .digest("hex"),
              purchaseChannel: String(body.purchase_channel),
            }
          : {}),
      });
      return context.body(null, 204, { "Cache-Control": "no-store" });
    } catch {
      return problem(context, 503, "Unavailable", "Checkout event could not be recorded.");
    }
  });

  app.post("/v1/assist/interactions", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    if (!shadowObservationStore) {
      return problem(
        context,
        503,
        "Internal API unavailable",
        "Assist interaction storage is temporarily unavailable.",
      );
    }
    const body = await readJsonObject(context, authenticated);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["request_id", "event", "proposed_value", "changed_fields"])) {
      return problem(context, 400, "Invalid request", "Request body contains unsupported fields.");
    }
    if (
      typeof body.request_id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        body.request_id,
      )
    ) {
      return problem(context, 400, "Invalid request", "Field 'request_id' is not valid.");
    }
    if (
      typeof body.event !== "string" ||
      !["shown", "applied", "kept", "undone"].includes(body.event)
    ) {
      return problem(context, 400, "Invalid request", "Field 'event' is not supported.");
    }
    if (
      body.proposed_value !== undefined &&
      (body.event !== "applied" ||
        typeof body.proposed_value !== "string" ||
        body.proposed_value.trim().length === 0 ||
        body.proposed_value.length > 512 ||
        containsControlCharacters(body.proposed_value))
    ) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'proposed_value' is only supported for a selected address.",
      );
    }
    const allowedChangedFields = new Set([
      "first_name",
      "last_name",
      "full_name",
      "company_name",
      "company_id",
      "vat_id",
      "street_line",
      "city",
      "postal_code",
      "country",
    ]);
    if (
      body.changed_fields !== undefined &&
      (!Array.isArray(body.changed_fields) ||
        body.changed_fields.length > 16 ||
        body.changed_fields.some(
          (field) => typeof field !== "string" || !allowedChangedFields.has(field),
        ))
    ) {
      return problem(context, 400, "Invalid request", "Field 'changed_fields' is not supported.");
    }
    try {
      await shadowObservationStore.recordAssistInteraction({
        projectRef: authenticated.apiKey.projectRef,
        apiKeyId: authenticated.apiKey.id,
        requestId: body.request_id,
        event: body.event as "shown" | "applied" | "kept" | "undone",
        ...(Array.isArray(body.changed_fields)
          ? { changedFields: body.changed_fields as string[] }
          : {}),
        ...(typeof body.proposed_value === "string"
          ? {
              proposedValue: body.proposed_value.trim(),
              proposedPreview: previewAddress(body.proposed_value),
            }
          : {}),
        occurredAt: now(),
      });
      return context.body(null, 204, { "Cache-Control": "no-store" });
    } catch {
      return problem(
        context,
        503,
        "Internal API unavailable",
        "Assist interaction could not be recorded.",
      );
    }
  });

  app.post("/v1/names/validate", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    const validationLimit = consumeValidationLimit(rateLimiter, authenticated);
    if (!validationLimit.allowed) return rateLimited(context, validationLimit);
    const idempotencyKey = resolveIdempotencyKey(context);
    if (idempotencyKey instanceof Response) return idempotencyKey;
    const clientMetadata = resolveValidationClientMetadata(context, authenticated);
    if (clientMetadata instanceof Response) return clientMetadata;

    const body = await readJsonObject(context, authenticated);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["full_name", "customer_type", "context", "policy"])) {
      return problem(context, 400, "Invalid request", "Request body contains unsupported fields.");
    }
    if (typeof body.full_name !== "string" || body.full_name.length > 240) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'full_name' must be a string with at most 240 characters.",
      );
    }
    if (
      body.customer_type !== undefined &&
      body.customer_type !== "private" &&
      body.customer_type !== "company"
    ) {
      return problem(context, 400, "Invalid request", "Field 'customer_type' is not supported.");
    }
    if (body.context !== undefined && body.context !== "billing" && body.context !== "shipping") {
      return problem(context, 400, "Invalid request", "Field 'context' is not supported.");
    }
    const policy = validationPolicy(body.policy);
    if (body.policy !== undefined && !policy) {
      return problem(context, 400, "Invalid request", "Field 'policy' is not supported.");
    }
    const idempotencyKeyHash = hashIdempotencyKey(
      authenticated.rawKey,
      JSON.stringify({
        operation: "name.validate",
        idempotencyKey,
        fullName: body.full_name,
        customerType: body.customer_type ?? "private",
        context: body.context ?? "billing",
        policy: policy ?? "assist",
      }),
    );
    const validationStartedAt = monotonicNow();
    const result = validatePersonName(body.full_name, {
      customerType: body.customer_type === "company" ? "company" : "private",
      context: body.context === "shipping" ? "shipping" : "billing",
      policy: policy ?? "assist",
      allowBlocking: false,
      now,
    });
    const durationMs = elapsedMilliseconds(validationStartedAt, monotonicNow());
    const envelope: ValidationEnvelope = {
      id: randomId(),
      object: "validation_result",
      request_id: context.get("requestId"),
      status: result.status,
      action: result.recommended_action,
      normalized: result.normalized,
      suggestion: result.suggestion,
      issues: result.issues,
      evidence: result.evidence,
    };
    // Both writes run together; a usage failure still answers with the same 503 as before.
    const [usageFailure] = await Promise.all([
      recordUsage(
        context,
        pilotStore,
        authenticated.apiKey,
        "name.validate",
        result.status,
        idempotencyKeyHash,
        clientMetadata,
        durationMs,
        now,
        randomId,
      ),
      recordShadowPreview(
        context,
        shadowObservationStore,
        authenticated.apiKey,
        "name.validate",
        body.full_name,
        idempotencyKeyHash,
        clientMetadata,
        envelope,
        durationMs,
        now,
        randomId,
      ),
    ]);
    if (usageFailure) return usageFailure;
    return noStoreJson(context, envelope, durationMs);
  });

  app.post("/v1/emails/validate", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    const validationLimit = consumeValidationLimit(rateLimiter, authenticated);
    if (!validationLimit.allowed) return rateLimited(context, validationLimit);
    const idempotencyKey = resolveIdempotencyKey(context);
    if (idempotencyKey instanceof Response) return idempotencyKey;
    const clientMetadata = resolveValidationClientMetadata(context, authenticated);
    if (clientMetadata instanceof Response) return clientMetadata;

    const body = await readJsonObject(context, authenticated);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["email", "policy"])) {
      return problem(context, 400, "Invalid request", "Request body contains unsupported fields.");
    }
    if (typeof body.email !== "string" || body.email.length < 3 || body.email.length > 320) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'email' must contain 3–320 characters.",
      );
    }
    const policy = validationPolicy(body.policy);
    if (body.policy !== undefined && !policy) {
      return problem(context, 400, "Invalid request", "Field 'policy' is not supported.");
    }
    const idempotencyKeyHash = hashIdempotencyKey(
      authenticated.rawKey,
      JSON.stringify({
        operation: "email.validate",
        idempotencyKey,
        email: body.email,
        policy: policy ?? "assist",
      }),
    );

    const validationStartedAt = monotonicNow();
    const result = await validateEmail(body.email, {
      lookupDns,
      rules: defaultCountryPack.emailRules,
      policy: policy ?? "assist",
      allowBlocking: false,
      now,
    });
    const durationMs = elapsedMilliseconds(validationStartedAt, monotonicNow());
    const envelope: ValidationEnvelope = {
      id: randomId(),
      object: "validation_result",
      request_id: context.get("requestId"),
      status: result.status,
      action: result.recommended_action,
      normalized: result.normalized,
      suggestion: result.suggestion,
      issues: result.issues,
      evidence: result.evidence,
    };

    // Both writes run together; a usage failure still answers with the same 503 as before.
    const [usageFailure] = await Promise.all([
      recordUsage(
        context,
        pilotStore,
        authenticated.apiKey,
        "email.validate",
        result.status,
        idempotencyKeyHash,
        clientMetadata,
        durationMs,
        now,
        randomId,
      ),
      recordShadowPreview(
        context,
        shadowObservationStore,
        authenticated.apiKey,
        "email.validate",
        body.email,
        idempotencyKeyHash,
        clientMetadata,
        envelope,
        durationMs,
        now,
        randomId,
      ),
    ]);
    if (usageFailure) return usageFailure;
    return noStoreJson(context, envelope, durationMs);
  });

  app.post("/v1/phones/validate", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    const validationLimit = consumeValidationLimit(rateLimiter, authenticated);
    if (!validationLimit.allowed) return rateLimited(context, validationLimit);
    const idempotencyKey = resolveIdempotencyKey(context);
    if (idempotencyKey instanceof Response) return idempotencyKey;
    const clientMetadata = resolveValidationClientMetadata(context, authenticated);
    if (clientMetadata instanceof Response) return clientMetadata;

    const body = await readJsonObject(context, authenticated);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["phone", "country"])) {
      return problem(context, 400, "Invalid request", "Request body contains unsupported fields.");
    }
    if (typeof body.phone !== "string" || body.phone.length < 3 || body.phone.length > 64) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'phone' must contain 3–64 characters.",
      );
    }
    const countryPack = resolveCountryPack(body.country);
    if (!countryPack) return unsupportedCountry(context);
    const idempotencyKeyHash = hashIdempotencyKey(
      authenticated.rawKey,
      JSON.stringify({
        operation: "phone.validate",
        idempotencyKey,
        phone: body.phone,
        country: countryPack.manifest.countryCode,
      }),
    );

    const validationStartedAt = monotonicNow();
    const result = countryPack.phone.validate(body.phone);
    const durationMs = elapsedMilliseconds(validationStartedAt, monotonicNow());
    const envelope: ValidationEnvelope = {
      id: randomId(),
      object: "validation_result",
      request_id: context.get("requestId"),
      status: result.status,
      action: result.recommended_action,
      normalized: result.normalized,
      suggestion: null,
      issues: result.issues.map((code) => ({
        code,
        severity: result.status === "invalid" ? "error" : "warning",
        message: code,
      })),
      evidence: [
        {
          source: "libphonenumber",
          checked_at: now().toISOString(),
          state: result.status === "invalid" ? "absent" : "confirmed",
        },
      ],
    };

    // Both writes run together; a usage failure still answers with the same 503 as before.
    const [usageFailure] = await Promise.all([
      recordUsage(
        context,
        pilotStore,
        authenticated.apiKey,
        "phone.validate",
        result.status,
        idempotencyKeyHash,
        clientMetadata,
        durationMs,
        now,
        randomId,
      ),
      recordShadowPreview(
        context,
        shadowObservationStore,
        authenticated.apiKey,
        "phone.validate",
        body.phone,
        idempotencyKeyHash,
        clientMetadata,
        envelope,
        durationMs,
        now,
        randomId,
      ),
    ]);
    if (usageFailure) return usageFailure;
    return noStoreJson(context, envelope, durationMs);
  });

  app.post("/v1/addresses/validate", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    const validationLimit = consumeValidationLimit(rateLimiter, authenticated);
    if (!validationLimit.allowed) return rateLimited(context, validationLimit);
    const idempotencyKey = resolveIdempotencyKey(context);
    if (idempotencyKey instanceof Response) return idempotencyKey;
    const clientMetadata = resolveValidationClientMetadata(context, authenticated);
    if (clientMetadata instanceof Response) return clientMetadata;

    const body = await readJsonObject(context, authenticated);
    if (body instanceof Response) return body;
    if (
      !hasOnlyKeys(body, ["address", "city", "postal_code", "country", "first_name", "last_name"])
    ) {
      return problem(context, 400, "Invalid request", "Request body contains unsupported fields.");
    }
    if (typeof body.address !== "string" || body.address.length < 3 || body.address.length > 512) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'address' must contain 3–512 characters.",
      );
    }
    if (
      body.city !== undefined &&
      (typeof body.city !== "string" || body.city.length < 1 || body.city.length > 160)
    ) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'city' must contain 1–160 characters when provided.",
      );
    }
    if (
      body.postal_code !== undefined &&
      (typeof body.postal_code !== "string" || !/^\d{3}\s?\d{2}$/.test(body.postal_code.trim()))
    ) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'postal_code' must contain a five-digit postal code.",
      );
    }
    const countryPack = body.country === undefined ? null : resolveCountryPack(body.country);
    if (!countryPack) {
      return problem(
        context,
        400,
        "Invalid request",
        `Field 'country' must be ${supportedCountriesText()}.`,
      );
    }
    if (
      typeof body.first_name !== "string" ||
      body.first_name.length > 100 ||
      typeof body.last_name !== "string" ||
      body.last_name.length > 100
    ) {
      return problem(
        context,
        400,
        "Invalid request",
        "Fields 'first_name' and 'last_name' must be strings with at most 100 characters.",
      );
    }

    const inputAddress = joinAddressInput(
      body.address,
      typeof body.city === "string" ? body.city : null,
      typeof body.postal_code === "string" ? body.postal_code : null,
    );
    const idempotencyKeyHash = hashIdempotencyKey(
      authenticated.rawKey,
      JSON.stringify({
        operation: "address.validate",
        idempotencyKey,
        address: body.address,
        city: body.city ?? null,
        postalCode: body.postal_code ?? null,
        country: countryPack.manifest.countryCode,
        firstNamePresent: isFilledPersonName(body.first_name),
        lastNamePresent: isFilledPersonName(body.last_name),
      }),
    );

    const validationStartedAt = monotonicNow();
    const addressValidation = countryPack.address.looksForeign(
      body.address,
      typeof body.city === "string" ? body.city : null,
      typeof body.postal_code === "string" ? body.postal_code : null,
    )
      ? invalidAddressCountry(inputAddress, countryPack.name, now().toISOString())
      : await validateAddressWithRuian(addressSearcher, inputAddress, now);
    const validated = withRequiredPersonNames(addressValidation, body.first_name, body.last_name);
    const durationMs = elapsedMilliseconds(validationStartedAt, monotonicNow());
    const envelope: ValidationEnvelope = {
      id: randomId(),
      object: "validation_result",
      request_id: context.get("requestId"),
      ...validated,
    };

    // Both writes run together; a usage failure still answers with the same 503 as before.
    const [usageFailure] = await Promise.all([
      recordUsage(
        context,
        pilotStore,
        authenticated.apiKey,
        "address.validate",
        envelope.status,
        idempotencyKeyHash,
        clientMetadata,
        durationMs,
        now,
        randomId,
      ),
      recordShadowPreview(
        context,
        shadowObservationStore,
        authenticated.apiKey,
        "address.validate",
        inputAddress,
        idempotencyKeyHash,
        clientMetadata,
        envelope,
        durationMs,
        now,
        randomId,
      ),
    ]);
    if (usageFailure) return usageFailure;
    return noStoreJson(context, envelope, durationMs);
  });

  app.post("/v1/addresses/autocomplete", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    const validationLimit = consumeValidationLimit(rateLimiter, authenticated);
    if (!validationLimit.allowed) return rateLimited(context, validationLimit);
    const idempotencyKey = resolveIdempotencyKey(context);
    if (idempotencyKey instanceof Response) return idempotencyKey;
    const clientMetadata = resolveValidationClientMetadata(context, authenticated);
    if (clientMetadata instanceof Response) return clientMetadata;

    const body = await readJsonObject(context, authenticated);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["query", "country", "limit", "components"])) {
      return problem(context, 400, "Invalid request", "Request body contains unsupported fields.");
    }
    if (typeof body.query !== "string" || body.query.trim().length < 3 || body.query.length > 256) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'query' must contain 3–256 characters.",
      );
    }
    const countryPack = resolveCountryPack(body.country);
    if (!countryPack) return unsupportedCountry(context);
    if (
      body.limit !== undefined &&
      (typeof body.limit !== "number" ||
        !Number.isInteger(body.limit) ||
        body.limit < 1 ||
        body.limit > 10)
    ) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'limit' must be an integer between 1 and 10.",
      );
    }

    const components = parseAddressComponents(body.components);
    if (components === "invalid") {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'components' must contain only street_line (≤200), city (≤80) and postal_code (≤10) strings.",
      );
    }
    if (
      components &&
      body.query !==
        [components.street_line.trim(), components.city.trim(), components.postal_code.trim()]
          .filter(Boolean)
          .join(" ")
          .slice(0, 256)
    ) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'query' must equal the non-empty trimmed components joined by one space.",
      );
    }

    const query = body.query.trim();
    const limit = typeof body.limit === "number" ? body.limit : 6;
    const idempotencyKeyHash = hashIdempotencyKey(
      authenticated.rawKey,
      JSON.stringify({
        operation: "address.autocomplete",
        idempotencyKey,
        query,
        country: countryPack.manifest.countryCode,
        limit,
        ...(components ? { components } : {}),
      }),
    );

    const startedAt = monotonicNow();
    // A Slovak PSČ or town never gets a "nearest" Czech address offered instead of a warning.
    const foreign = components
      ? countryPack.address.looksForeign(
          components.street_line,
          components.city,
          components.postal_code,
        )
      : countryPack.address.looksForeign(query, null, null);
    const envelope = foreign
      ? foreignAddressAutocomplete(now().toISOString())
      : await autocompleteCzechAddress(addressSearcher, query, limit, now, components ?? undefined);
    const durationMs = elapsedMilliseconds(startedAt, monotonicNow());
    const response: AddressAutocompleteEnvelope = {
      object: "address_suggestion_list",
      request_id: context.get("requestId"),
      ...envelope,
    };
    // Started first so record IDs keep their order; it runs together with the observation below.
    const usage = recordUsage(
      context,
      pilotStore,
      authenticated.apiKey,
      "address.autocomplete",
      response.status,
      idempotencyKeyHash,
      clientMetadata,
      durationMs,
      now,
      randomId,
    );
    const firstSuggestion = response.suggestions[0]?.label ?? null;
    const observationEnvelope: ValidationEnvelope = {
      id: randomId(),
      object: "validation_result",
      request_id: context.get("requestId"),
      status:
        response.status === "matched"
          ? "correctable"
          : response.status === "no_match"
            ? "risky"
            : "unknown",
      action:
        response.status === "matched"
          ? "suggest"
          : response.status === "no_match"
            ? "warn"
            : "fail_open",
      normalized: query,
      suggestion: firstSuggestion,
      issues: [
        {
          code:
            response.status === "matched"
              ? "address.autocomplete_suggestion"
              : response.status === "no_match"
                ? "address.autocomplete_no_match"
                : "address.ruian_unavailable",
          severity: response.status === "matched" ? "info" : "warning",
          message:
            response.status === "matched"
              ? "RÚIAN returned structured Czech address suggestions."
              : response.status === "no_match"
                ? "RÚIAN did not find a matching Czech address."
                : "RÚIAN address autocomplete is temporarily unavailable.",
        },
        ...(response.advice && response.advice.code !== "address.no_match"
          ? [
              {
                code: response.advice.code,
                severity: "warning" as const,
                message:
                  response.advice.code === "address.postal_code_mismatch"
                    ? "The street, number and municipality match one address with another PSČ."
                    : response.advice.code === "address.country_mismatch"
                      ? "The PSČ or municipality belongs to another country than Czechia."
                      : "The street is known in the municipality but the house number is missing.",
              },
            ]
          : []),
      ],
      evidence: response.evidence,
    };
    const [usageFailure] = await Promise.all([
      usage,
      recordShadowPreview(
        context,
        shadowObservationStore,
        authenticated.apiKey,
        "address.validate",
        query,
        idempotencyKeyHash,
        clientMetadata,
        observationEnvelope,
        durationMs,
        now,
        randomId,
      ),
    ]);
    if (usageFailure) return usageFailure;
    return noStoreJson(context, response, durationMs);
  });

  app.post("/v1/company-ids/validate", async (context) => {
    const authenticated = await authenticateValidation(context);
    if (authenticated instanceof Response) return authenticated;
    const validationLimit = consumeValidationLimit(rateLimiter, authenticated);
    if (!validationLimit.allowed) return rateLimited(context, validationLimit);
    const idempotencyKey = resolveIdempotencyKey(context);
    if (idempotencyKey instanceof Response) return idempotencyKey;
    const clientMetadata = resolveValidationClientMetadata(context, authenticated);
    if (clientMetadata instanceof Response) return clientMetadata;

    const body = await readJsonObject(context, authenticated);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["company_id", "country"])) {
      return problem(context, 400, "Invalid request", "Request body contains unsupported fields.");
    }
    if (
      typeof body.company_id !== "string" ||
      body.company_id.length < 1 ||
      body.company_id.length > 32
    ) {
      return problem(
        context,
        400,
        "Invalid request",
        "Field 'company_id' must contain 1–32 characters.",
      );
    }
    const countryPack = resolveCountryPack(body.country);
    if (!countryPack) return unsupportedCountry(context);
    const idempotencyKeyHash = hashIdempotencyKey(
      authenticated.rawKey,
      JSON.stringify({
        operation: "company_id.validate",
        idempotencyKey,
        companyId: body.company_id,
        country: countryPack.manifest.countryCode,
      }),
    );

    const validationStartedAt = monotonicNow();
    const validated = await validateCompanyIdWithAres(lookupAres, body.company_id, now);
    if (validated.company) knownCompanies.set(validated.company.ico, validated.company);
    const durationMs = elapsedMilliseconds(validationStartedAt, monotonicNow());
    const envelope: ValidationEnvelope = {
      id: randomId(),
      object: "validation_result",
      request_id: context.get("requestId"),
      ...validated,
    };

    // Both writes run together; a usage failure still answers with the same 503 as before.
    const [usageFailure] = await Promise.all([
      recordUsage(
        context,
        pilotStore,
        authenticated.apiKey,
        "company_id.validate",
        envelope.status,
        idempotencyKeyHash,
        clientMetadata,
        durationMs,
        now,
        randomId,
      ),
      recordShadowPreview(
        context,
        shadowObservationStore,
        authenticated.apiKey,
        "company_id.validate",
        body.company_id,
        idempotencyKeyHash,
        clientMetadata,
        envelope,
        durationMs,
        now,
        randomId,
      ),
    ]);
    if (usageFailure) return usageFailure;
    return noStoreJson(context, envelope, durationMs);
  });

  app.notFound((context) =>
    problem(context, 404, "Resource not found", "The requested Checkdrop resource does not exist."),
  );

  return app;
}

function resolvePilotStore(dependencies: AppDependencies): PilotStore | null {
  if (dependencies.pilotStore !== undefined) return dependencies.pilotStore;
  const connectionString = process.env.CHECKDROP_DATABASE_URL;
  return connectionString ? createPostgresPilotStore(connectionString) : null;
}

function resolveShadowObservationStore(
  dependencies: AppDependencies,
  observationEncryptionKey: string | null,
): ShadowObservationStore | null {
  if (dependencies.shadowObservationStore !== undefined) return dependencies.shadowObservationStore;
  const connectionString = process.env.CHECKDROP_DATABASE_URL;
  return connectionString
    ? createPostgresShadowObservationStore(connectionString, observationEncryptionKey)
    : null;
}

function resolveAddressSearcher(dependencies: AppDependencies): AddressSearcher | null {
  if (dependencies.addressSearcher !== undefined) return dependencies.addressSearcher;
  const connectionString = process.env.CHECKDROP_DATABASE_URL;
  return connectionString ? createPostgresAddressSearcher(connectionString) : null;
}

function resolveIntegrationStore(dependencies: AppDependencies): IntegrationStore | null {
  if (dependencies.integrationStore !== undefined) return dependencies.integrationStore;
  const connectionString = process.env.CHECKDROP_DATABASE_URL;
  return connectionString ? createPostgresIntegrationStore(connectionString) : null;
}

function joinAddressInput(address: string, city: string | null, postalCode: string | null): string {
  const compactPostalCode = postalCode?.replace(/\D/g, "");
  return [address.trim(), city?.trim(), compactPostalCode].filter(Boolean).join(", ");
}

function isFilledPersonName(value: string): boolean {
  return value.trim().length > 0 && /\p{L}/u.test(value);
}

function withRequiredPersonNames(
  addressValidation: ValidationPayload,
  firstName: string,
  lastName: string,
): ValidationPayload {
  const issues = [];
  if (!isFilledPersonName(firstName)) {
    issues.push(
      validationIssue(
        "person.first_name_missing",
        "error",
        "First name must be filled in for the delivery contact.",
      ),
    );
  }
  if (!isFilledPersonName(lastName)) {
    issues.push(
      validationIssue(
        "person.last_name_missing",
        "error",
        "Last name must be filled in for the delivery contact.",
      ),
    );
  }
  if (issues.length === 0) return addressValidation;
  return {
    ...addressValidation,
    status: "invalid",
    action: "block",
    issues: [...issues, ...addressValidation.issues],
  };
}

function unsupportedCountry(context: Context): Response {
  return problem(
    context,
    400,
    "Invalid request",
    `Only country ${supportedCountriesText()} is supported.`,
  );
}

function invalidAddressCountry(
  input: string,
  countryName: string,
  checkedAt: string,
): ValidationPayload {
  return {
    status: "invalid",
    action: "block",
    normalized: input.trim(),
    suggestion: null,
    issues: [
      validationIssue(
        "address.country_mismatch",
        "error",
        `The address does not match the declared country ${countryName}.`,
      ),
    ],
    evidence: [
      {
        source: "country",
        checked_at: checkedAt,
        state: "confirmed",
        detail: "address.country_mismatch",
      },
    ],
  };
}

async function validateAddressWithRuian(
  searcher: AddressSearcher | null,
  input: string,
  now: () => Date,
): Promise<ValidationPayload> {
  const checkedAt = now().toISOString();
  if (!searcher) return unavailableAddress(input, checkedAt);

  let result: Awaited<ReturnType<AddressSearcher["search"]>>;
  try {
    result = await searcher.search(input, { limit: 2 });
  } catch {
    return unavailableAddress(input, checkedAt);
  }

  const resolution = classifyRuianAddress(input, result);
  const first = result.suggestions[0];
  const evidence = [
    {
      source: "ruian",
      checked_at: checkedAt,
      state: result.status === "matched" ? "confirmed" : "absent",
      detail: result.evidence.sourceVersion
        ? `ruian.snapshot.${result.evidence.sourceVersion.slice(0, 10)}`
        : "ruian.address_lookup",
    },
  ];
  if (resolution.status === "clean") {
    return {
      status: "valid",
      action: "accept",
      normalized: resolution.corrected ?? input.trim(),
      suggestion: null,
      issues: [],
      evidence,
    };
  }
  if (resolution.status === "corrected" && resolution.corrected) {
    return {
      status: "correctable",
      action: "suggest",
      normalized: input.trim(),
      suggestion: resolution.corrected,
      issues: [
        validationIssue(
          "address.ruian_normalized",
          "warning",
          "Address has a safer standardized RÚIAN form.",
        ),
      ],
      evidence,
    };
  }

  const ambiguous = result.suggestions.length > 1;
  const issueCode = first
    ? ambiguous
      ? "address.ruian_ambiguous"
      : "address.ruian_low_confidence"
    : "address.ruian_not_found";
  return {
    status: "risky",
    action: "warn",
    normalized: input.trim(),
    suggestion: null,
    issues: [validationIssue(issueCode, "warning", resolution.reason)],
    evidence,
  };
}

function parseAddressComponents(
  value: unknown,
): { street_line: string; city: string; postal_code: string } | null | "invalid" {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "city,postal_code,street_line") return "invalid";
  const { street_line, city, postal_code } = record;
  if (
    typeof street_line !== "string" ||
    typeof city !== "string" ||
    typeof postal_code !== "string" ||
    street_line.length > 200 ||
    city.length > 80 ||
    postal_code.length > 10
  )
    return "invalid";
  return { street_line, city, postal_code };
}

async function autocompleteCzechAddress(
  searcher: AddressSearcher | null,
  query: string,
  limit: number,
  now: () => Date,
  components?: { street_line: string; city: string; postal_code: string },
): Promise<Omit<AddressAutocompleteEnvelope, "object" | "request_id">> {
  const checkedAt = now().toISOString();
  if (!searcher) {
    return unavailableAddressAutocomplete(checkedAt);
  }

  let result: Awaited<ReturnType<AddressSearcher["search"]>>;
  try {
    result = await searcher.search(query, {
      limit,
      candidateLimit: 75,
      ...(components ? { components } : {}),
    });
  } catch {
    return unavailableAddressAutocomplete(checkedAt);
  }

  const advice = result.advice;
  return {
    status: result.suggestions.length > 0 ? "matched" : "no_match",
    ...(advice
      ? {
          advice:
            advice.code === "address.postal_code_mismatch"
              ? { code: advice.code, postal_code: advice.postal_code }
              : { code: advice.code },
        }
      : {}),
    country: "CZ",
    suggestions: result.suggestions.map((suggestion) => {
      const compoundNumber = suggestion.orientationNumber
        ? `${suggestion.houseNumber}/${suggestion.orientationNumber}`
        : suggestion.houseNumber;
      return {
        id: suggestion.id,
        label: suggestion.addressLine,
        street_line: [suggestion.street, compoundNumber].filter(Boolean).join(" "),
        street: suggestion.street,
        house_number: suggestion.houseNumber,
        orientation_number: suggestion.orientationNumber,
        city: suggestion.municipality,
        city_part: suggestion.municipalityPart,
        postal_code: suggestion.postalCode,
      };
    }),
    evidence: [
      {
        source: "ruian",
        checked_at: checkedAt,
        state: result.suggestions.length > 0 ? "confirmed" : "absent",
        detail: result.evidence.sourceVersion
          ? `ruian.snapshot.${result.evidence.sourceVersion.slice(0, 10)}`
          : "ruian.address_autocomplete",
      },
    ],
  };
}

function foreignAddressAutocomplete(
  checkedAt: string,
): Omit<AddressAutocompleteEnvelope, "object" | "request_id"> {
  return {
    status: "no_match",
    advice: { code: "address.country_mismatch" },
    country: "CZ",
    suggestions: [],
    evidence: [
      {
        source: "ruian",
        checked_at: checkedAt,
        state: "absent",
        detail: "address.country_mismatch",
      },
    ],
  };
}

function unavailableAddressAutocomplete(
  checkedAt: string,
): Omit<AddressAutocompleteEnvelope, "object" | "request_id"> {
  return {
    status: "unavailable",
    country: "CZ",
    suggestions: [],
    evidence: [
      {
        source: "ruian",
        checked_at: checkedAt,
        state: "unavailable",
        detail: "address.ruian_unavailable",
      },
    ],
  };
}

function unavailableAddress(input: string, checkedAt: string): ValidationPayload {
  return {
    status: "unknown",
    action: "fail_open",
    normalized: input.trim(),
    suggestion: null,
    issues: [
      validationIssue(
        "address.ruian_unavailable",
        "warning",
        "RÚIAN address validation is temporarily unavailable.",
      ),
    ],
    evidence: [
      {
        source: "ruian",
        checked_at: checkedAt,
        state: "unavailable",
        detail: "address.ruian_unavailable",
      },
    ],
  };
}

async function validateCompanyIdWithAres(
  lookup: AresLookup,
  input: string,
  now: () => Date,
): Promise<ValidationPayload> {
  const checkedAt = now().toISOString();
  let result: AresLookupResult;
  try {
    result = await lookup(input);
  } catch {
    return unavailableCompanyId(input, checkedAt);
  }

  const evidenceDetail = result.evidence[0]?.detail;
  const evidenceState =
    result.lookup_state === "confirmed"
      ? "confirmed"
      : result.lookup_state === "not_found"
        ? "absent"
        : result.lookup_state === "invalid_input"
          ? "not_applicable"
          : "unavailable";
  const evidence = [
    {
      source: "ares",
      checked_at: result.evidence[0]?.checked_at ?? checkedAt,
      state: evidenceState,
      ...(evidenceDetail ? { detail: evidenceDetail } : {}),
    },
  ];

  if (result.lookup_state === "invalid_input") {
    return {
      status: "invalid",
      action: "warn",
      normalized: result.normalized_ico,
      suggestion: null,
      issues: result.issues.map((code) =>
        validationIssue(code, "error", "IČO has an invalid format or checksum."),
      ),
      evidence,
    };
  }
  if (result.lookup_state === "confirmed" && result.normalized_ico) {
    const changed = input.trim() !== result.normalized_ico;
    return {
      status: changed ? "correctable" : "valid",
      action: changed ? "normalize" : "accept",
      normalized: result.normalized_ico,
      suggestion: null,
      issues: changed
        ? [
            validationIssue(
              "company.ico_normalized",
              "info",
              "IČO was confirmed by ARES in normalized form.",
            ),
          ]
        : [],
      evidence,
      company: result.company,
    };
  }
  if (result.lookup_state === "not_found") {
    return {
      status: "risky",
      action: "warn",
      normalized: result.normalized_ico,
      suggestion: null,
      issues: [validationIssue("company.ares_not_found", "warning", "IČO was not found in ARES.")],
      evidence,
    };
  }
  return unavailableCompanyId(result.normalized_ico ?? input, checkedAt, evidenceDetail);
}

function unavailableCompanyId(
  input: string,
  checkedAt: string,
  detail = "company.ares_unavailable",
): ValidationPayload {
  return {
    status: "unknown",
    action: "fail_open",
    normalized: input.trim() || null,
    suggestion: null,
    issues: [
      validationIssue(
        "company.ares_unavailable",
        "warning",
        "ARES company validation is temporarily unavailable.",
      ),
    ],
    evidence: [{ source: "ares", checked_at: checkedAt, state: "unavailable", detail }],
  };
}

function validationIssue(code: string, severity: "info" | "warning" | "error", message: string) {
  return { code, severity, message };
}

async function authenticateRequest(
  context: Context,
  pilotStore: PilotStore | null,
  rateLimiter: PilotRateLimiter,
): Promise<AuthenticatedRequest | Response> {
  if (!pilotStore) {
    return problem(
      context,
      503,
      "Internal API unavailable",
      "Pilot API-key storage is not configured.",
    );
  }

  const rawKey = context.req.header("X-Checkdrop-Key")?.trim() ?? "";
  const prefix = extractApiKeyPrefix(rawKey);
  if (!prefix) return unauthorized(context);
  const authenticationLimit = rateLimiter.consumeAuthentication(prefix);
  if (!authenticationLimit.allowed) return rateLimited(context, authenticationLimit);

  let apiKey: PilotApiKeyRecord | null;
  try {
    apiKey = await pilotStore.findApiKeyByPrefix(prefix);
  } catch {
    return problem(
      context,
      503,
      "Internal API unavailable",
      "Pilot API-key verification is temporarily unavailable.",
    );
  }

  if (apiKey?.state !== "active" || !verifyApiKey(rawKey, apiKey.verifier)) {
    return unauthorized(context);
  }
  return { apiKey, rawKey };
}

async function authenticateValidationRequest(
  context: Context,
  pilotStore: PilotStore | null,
  runtime: EmbedRuntime | null,
  embedSigningSecret: string | null,
  rateLimiter: PilotRateLimiter,
): Promise<AuthenticatedRequest | Response> {
  const siteKey = context.req.query("site")?.trim();
  if (!siteKey) return authenticateRequest(context, pilotStore, rateLimiter);
  if (context.req.header("X-Checkdrop-Key")) {
    return problem(
      context,
      400,
      "Invalid request",
      "Embed requests cannot combine a public site identifier with a private API key.",
    );
  }
  if (!EMBED_PATHS.has(context.req.path)) return unauthorized(context);
  return authenticateEmbedRequest(context, siteKey, runtime, embedSigningSecret, rateLimiter);
}

async function authenticateEmbedRequest(
  context: Context,
  siteKey: string,
  runtime: EmbedRuntime | null,
  embedSigningSecret: string | null,
  rateLimiter: PilotRateLimiter,
): Promise<AuthenticatedRequest | Response> {
  const match = /^cdp_site_([A-Za-z0-9-]{3,80})$/.exec(siteKey);
  if (!match?.[1]) return embedForbidden(context);
  if (!runtime || !embedSigningSecret || embedSigningSecret.length < 32) {
    return problem(
      context,
      503,
      "Embed unavailable",
      "Hosted form validation is temporarily unavailable.",
    );
  }

  let integration: RuntimeIntegration | null;
  try {
    integration = await runtime.integration(match[1]);
  } catch {
    return problem(
      context,
      503,
      "Embed unavailable",
      "Hosted form validation is temporarily unavailable.",
    );
  }
  const origin = context.req.header("Origin")?.trim() ?? "";
  if (integration?.state !== "shadow" || !origin) return embedForbidden(context);

  let configuredOrigin: string;
  try {
    configuredOrigin = new URL(integration.formUrl).origin;
  } catch {
    return embedForbidden(context);
  }
  if (origin !== configuredOrigin) return embedForbidden(context);
  const requestedFormId = context.req.query("form")?.trim() ?? null;
  const selectedForm = requestedFormId
    ? (integration.forms.find(
        (form) => form.id === requestedFormId && form.state === "configured",
      ) ?? null)
    : (integration.forms.find((form) => form.isDefault && form.state === "configured") ?? null);
  if (context.req.path !== "/v1/integration/config" && !selectedForm) {
    return embedForbidden(context);
  }
  const activeKey = integration.apiKeys.find((key) => key.state === "active");
  if (!activeKey) {
    return problem(
      context,
      503,
      "Embed unavailable",
      "Hosted form validation is temporarily unavailable.",
    );
  }

  const checkoutSessionId = context.req.query("session")?.trim() ?? null;
  if (
    checkoutSessionId !== null &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      checkoutSessionId,
    )
  ) {
    return problem(context, 400, "Invalid request", "Checkout session identifier is not valid.");
  }

  // The origin is verified, so even a 429 carries CORS headers and the script can read Retry-After.
  context.header("Access-Control-Allow-Origin", origin);
  context.header("Vary", "Origin");
  // Preflights are free; each shopper's session has its own budget under a site-wide ceiling.
  if (context.req.method !== "OPTIONS") {
    const limit = rateLimiter.consumeEmbed(
      siteKey,
      checkoutSessionId?.toLowerCase() ?? null,
      embedRateLimitBucket(context.req.path),
    );
    if (!limit.allowed) return rateLimited(context, limit);
  }

  const checkoutSessionRef = checkoutSessionId
    ? createHmac("sha256", embedSigningSecret)
        .update(`${siteKey}\0${checkoutSessionId}`)
        .digest("hex")
    : null;

  return {
    apiKey: {
      id: activeKey.id,
      projectRef: integration.projectRef,
      name: activeKey.name,
      keyPrefix: activeKey.keyPrefix,
      verifier: "",
      state: "active",
      integrationId: integration.id,
      environment: activeKey.environment,
    },
    rawKey: createHmac("sha256", embedSigningSecret).update(siteKey).digest("hex"),
    trustedClientMetadata: {
      integrationMode: "shadow",
      clientName: integration.clientName,
      observationMode: "preview",
      formId: selectedForm?.id ?? null,
      formName: selectedForm?.name ?? null,
      checkoutSessionRef,
    },
    embed: true,
  };
}

function embedRateLimitBucket(path: string): EmbedRateLimitBucket {
  if (path === "/v1/assist/interactions") return "assist";
  if (path === "/v1/checkout/events") return "checkout";
  return "validation";
}

/** Hosted-script requests were counted per checkout session when they were authenticated. */
function consumeValidationLimit(
  rateLimiter: PilotRateLimiter,
  authenticated: AuthenticatedRequest,
): RateLimitDecision {
  return authenticated.embed ? ALLOWED : rateLimiter.consumeValidation(authenticated.apiKey.id);
}

function resolveValidationClientMetadata(
  context: Context,
  authenticated: AuthenticatedRequest,
): ClientMetadata | Response {
  return authenticated.trustedClientMetadata ?? resolveClientMetadata(context);
}

function embedForbidden(context: Context): Response {
  return problem(
    context,
    403,
    "Embed unavailable",
    "Hosted form validation is not enabled for this origin.",
  );
}

async function recordUsage(
  context: Context,
  pilotStore: PilotStore | null,
  apiKey: PilotApiKeyRecord,
  operation: string,
  resultClass: string,
  idempotencyKeyHash: string,
  clientMetadata: ClientMetadata,
  durationMs: number,
  now: () => Date,
  randomId: () => string,
  units = 1,
): Promise<Response | null> {
  if (!pilotStore) throw new Error("Authenticated requests always have a pilot store.");

  try {
    await measureRequestPhase(context, "usage", () =>
      pilotStore.recordUsage({
        id: randomId(),
        requestId: context.get("requestId"),
        projectRef: apiKey.projectRef,
        apiKeyId: apiKey.id,
        operation,
        idempotencyKeyHash,
        integrationMode: clientMetadata.integrationMode,
        clientName: clientMetadata.clientName,
        durationMs,
        units,
        resultClass,
        createdAt: now(),
      }),
    );
    return null;
  } catch {
    return problem(
      context,
      503,
      "Internal API unavailable",
      "Usage recording is temporarily unavailable.",
    );
  }
}

async function recordShadowPreview(
  context: Context,
  store: ShadowObservationStore | null,
  apiKey: PilotApiKeyRecord,
  operation: ShadowObservationOperation,
  input: string,
  idempotencyKeyHash: string,
  clientMetadata: ClientMetadata,
  result: ValidationEnvelope,
  durationMs: number,
  now: () => Date,
  randomId: () => string,
): Promise<void> {
  if (clientMetadata.observationMode !== "preview") return;
  if (!store || !clientMetadata.clientName) {
    context.header("X-Checkdrop-Observation", "unavailable");
    return;
  }
  const clientName = clientMetadata.clientName;
  const createdAt = now();
  const proposedValue =
    result.status === "correctable"
      ? (result.suggestion ?? result.normalized)
      : result.status === "valid"
        ? result.normalized
        : null;
  try {
    const inserted = await measureRequestPhase(context, "observation", () =>
      store.save({
        id: randomId(),
        requestId: context.get("requestId"),
        projectRef: apiKey.projectRef,
        apiKeyId: apiKey.id,
        operation,
        idempotencyKeyHash,
        clientName,
        formId: clientMetadata.formId ?? null,
        checkoutSessionRef: clientMetadata.checkoutSessionRef ?? null,
        inputValue: input,
        proposedValue,
        inputPreview: previewValue(operation, input),
        proposedPreview: proposedValue ? previewValue(operation, proposedValue) : null,
        changed: proposedValue !== null && proposedValue.trim() !== input.trim(),
        resultClass: result.status as ShadowObservationStatus,
        action: result.action as ShadowObservationAction,
        issueCodes: validationIssueCodes(result.issues),
        evidenceSources: validationEvidenceSources(result.evidence),
        durationMs,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + SHADOW_OBSERVATION_RETENTION_MS),
      }),
    );
    context.header("X-Checkdrop-Observation", inserted ? "stored" : "duplicate");
  } catch {
    context.header("X-Checkdrop-Observation", "unavailable");
  }
}

function resolveClientMetadata(context: Context): ClientMetadata | Response {
  const rawMode = context.req.header("X-Checkdrop-Mode")?.trim();
  if (rawMode !== undefined && rawMode !== "shadow") {
    return problem(
      context,
      400,
      "Invalid request",
      "Header 'X-Checkdrop-Mode' must be 'shadow' when provided.",
    );
  }

  const rawClientName = context.req.header("X-Checkdrop-Client");
  const clientName = rawClientName?.trim() ?? null;
  if (
    clientName !== null &&
    (clientName.length === 0 ||
      clientName.length > 64 ||
      !/^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(clientName) ||
      /^cdp_/i.test(clientName))
  ) {
    return problem(
      context,
      400,
      "Invalid request",
      "Header 'X-Checkdrop-Client' must contain a safe 1–64 character client identifier.",
    );
  }
  if (rawMode === "shadow" && clientName === null) {
    return problem(
      context,
      400,
      "Invalid request",
      "Shadow requests require header 'X-Checkdrop-Client'.",
    );
  }

  const rawObservationMode = context.req.header("X-Checkdrop-Observe")?.trim();
  if (rawObservationMode !== undefined && rawObservationMode !== "preview") {
    return problem(
      context,
      400,
      "Invalid request",
      "Header 'X-Checkdrop-Observe' must be 'preview' when provided.",
    );
  }
  if (rawObservationMode === "preview" && rawMode !== "shadow") {
    return problem(
      context,
      400,
      "Invalid request",
      "Masked observation previews require shadow mode.",
    );
  }

  return {
    integrationMode: rawMode === "shadow" ? "shadow" : "api",
    clientName,
    observationMode: rawObservationMode === "preview" ? "preview" : "none",
  };
}

function resolveIdempotencyKey(context: Context): string | Response {
  const rawIdempotencyKey = context.req.header("Idempotency-Key");
  if (rawIdempotencyKey === undefined) {
    return context.get("requestId");
  }
  const idempotencyKey = rawIdempotencyKey.trim();
  if (idempotencyKey.length === 0 || idempotencyKey.length > 128) {
    return problem(
      context,
      400,
      "Invalid request",
      "Header 'Idempotency-Key' must contain 1–128 characters.",
    );
  }
  return idempotencyKey;
}

async function readJsonObject(
  context: Context,
  authenticated: AuthenticatedRequest,
): Promise<Record<string, unknown> | Response> {
  const contentType = context.req.header("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  // The hosted script posts JSON as text/plain so browsers skip the CORS preflight. It is accepted
  // only after the embed sign-in has matched the Origin to the integration; no cookies are used.
  if (
    contentType !== "application/json" &&
    !(authenticated.embed && contentType === "text/plain")
  ) {
    return problem(
      context,
      415,
      "Unsupported media type",
      "Request body must use application/json.",
    );
  }

  const declaredLength = context.req.header("Content-Length");
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) {
      return problem(
        context,
        400,
        "Invalid request",
        "Content-Length must be a non-negative integer.",
      );
    }
    if (Number(declaredLength) > MAX_VALIDATION_BODY_BYTES) return bodyTooLarge(context);
  }

  let bodyBytes: Uint8Array | null;
  try {
    bodyBytes = await readBoundedBody(context.req.raw.body, MAX_VALIDATION_BODY_BYTES);
  } catch {
    return problem(context, 400, "Invalid request", "Request body could not be read.");
  }
  if (bodyBytes === null) return bodyTooLarge(context);

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return problem(context, 400, "Invalid request", "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return problem(context, 400, "Invalid request", "Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function validationPolicy(value: unknown): "assist" | "standard" | "strict" | null {
  return value === "assist" || value === "standard" || value === "strict" ? value : null;
}

function hasOnlyKeys(body: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(body).every((key) => allowed.has(key));
}

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function unauthorized(context: Context): Response {
  return problem(context, 401, "Unauthorized", "A valid API key is required.");
}

function rateLimited(context: Context, decision: RateLimitDecision): Response {
  return problem(
    context,
    429,
    "Too many requests",
    "The request limit has been reached. Retry later.",
    {
      "Retry-After": String(decision.retryAfterSeconds),
      // Lets the hosted script read when to resume; it is not a CORS-safelisted header.
      "Access-Control-Expose-Headers": "Retry-After",
    },
  );
}

function bodyTooLarge(context: Context): Response {
  return problem(
    context,
    413,
    "Request too large",
    "Request body exceeds the 8192-byte validation limit.",
  );
}

function noStoreJson(
  context: Context,
  body: ValidationEnvelope | AddressAutocompleteEnvelope | CompanyAutocompleteEnvelope,
  durationMs: number,
): Response {
  context.header("Cache-Control", "no-store");
  context.header("Server-Timing", `checkdrop;dur=${durationMs}`);
  return context.json(body, 200);
}

function previewValue(operation: ShadowObservationOperation, value: string): string {
  if (operation === "name.validate") return previewName(value);
  if (operation === "email.validate") return previewEmail(value);
  if (operation === "phone.validate") return previewPhone(value);
  if (operation === "address.validate") return previewAddress(value);
  return previewCompanyId(value);
}

function previewName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => (part ? `${part.slice(0, 1)}•••` : ""))
    .join(" ")
    .slice(0, 160);
}

function previewEmail(value: string): string {
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf("@");
  if (separator <= 0 || separator === trimmed.length - 1) return maskToken(trimmed);
  const local = trimmed.slice(0, separator);
  const domain = trimmed.slice(separator + 1).toLocaleLowerCase("en-US");
  return `${maskToken(local)}@${domain}`.slice(0, 160);
}

function previewPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("420") && digits.length > 9 ? digits.slice(3) : digits;
  const ending = national.slice(-3).padStart(3, "•");
  const prefix = digits.startsWith("420") && digits.length > 9 ? "+420 " : "";
  return `${prefix}••• ••• ${ending}`;
}

function previewAddress(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\d/g, "•").slice(0, 160);
}

function previewCompanyId(value: string): string {
  const digitCount = (value.match(/\d/g) ?? []).length;
  let seen = 0;
  return value
    .trim()
    .replace(/\d/g, (digit) => {
      seen += 1;
      return seen <= Math.max(0, digitCount - 3) ? "•" : digit;
    })
    .slice(0, 160);
}

function maskToken(value: string): string {
  const compact = value.trim();
  if (!compact) return "•••";
  return `${compact.slice(0, 1)}•••`.slice(0, 160);
}

function validationIssueCodes(issues: readonly unknown[]): string[] {
  const codes = issues.flatMap((issue) => {
    if (typeof issue === "string") return [issue];
    if (issue && typeof issue === "object" && "code" in issue && typeof issue.code === "string") {
      return [issue.code];
    }
    return [];
  });
  return [...new Set(codes)].slice(0, 32);
}

function validationEvidenceSources(evidence: readonly unknown[]): string[] {
  const sources = evidence.flatMap((entry) => {
    if (
      entry &&
      typeof entry === "object" &&
      "source" in entry &&
      typeof entry.source === "string"
    ) {
      return [entry.source];
    }
    return [];
  });
  return [...new Set(sources)].slice(0, 16);
}

function elapsedMilliseconds(startedAt: number, completedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return 0;
  return Math.min(300_000, Math.max(0, Math.round(completedAt - startedAt)));
}

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503,
  title: string,
  detail: string,
  extraHeaders: Record<string, string> = {},
) {
  return context.json(
    {
      type: `${PROBLEM_TYPE_BASE}/${problemSlug(status)}`,
      title,
      status,
      detail,
      request_id: context.get("requestId"),
    },
    status,
    {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  );
}

function problemSlug(status: number): string {
  if (status === 400) return "invalid-request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 413) return "request-too-large";
  if (status === 415) return "unsupported-media-type";
  if (status === 429) return "rate-limited";
  return "service-unavailable";
}
