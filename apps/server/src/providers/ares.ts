import type {
  ProviderEvidence,
  ProviderHealth,
  ProviderLookupState,
  RecommendedAction,
  ValidationStatus,
} from "@checkdrop/core";
import { validateCzechCompanyId } from "@checkdrop/pack-cz";
import {
  type FetchLike,
  fetchWithTimeout,
  isRecord,
  nullableString,
  type ProviderRuntimeOptions,
  ProviderTimeoutError,
  readBoundedJson,
  trimTrailingSlash,
} from "./runtime.js";

const DEFAULT_ARES_BASE_URL = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest";
const DEFAULT_TIMEOUT_MS = 4_000;

export interface AresCompany {
  readonly ico: string;
  readonly name: string;
  readonly vat_id: string | null;
  readonly address: string | null;
  readonly address_standardized: boolean | null;
  readonly updated_at: string | null;
  readonly primary_source: string | null;
  readonly registered_office?: {
    readonly street_line: string | null;
    readonly city: string | null;
    readonly postal_code: string | null;
    readonly country: "CZ";
  } | null;
}

export interface AresAutocompleteResult {
  readonly object: "company_suggestion_list";
  readonly provider: "ares";
  readonly input: string;
  readonly status: "matched" | "no_match" | "unavailable";
  readonly companies: readonly AresCompany[];
  readonly issues: readonly string[];
  readonly evidence: readonly ProviderEvidence[];
}

export interface AresLookupResult {
  readonly object: "company_lookup_result";
  readonly provider: "ares";
  readonly input: string;
  readonly normalized_ico: string | null;
  readonly lookup_state: ProviderLookupState;
  readonly status: ValidationStatus;
  readonly recommended_action: RecommendedAction;
  readonly company: AresCompany | null;
  readonly issues: readonly string[];
  readonly evidence: readonly ProviderEvidence[];
}

export interface AresClientOptions extends ProviderRuntimeOptions {
  readonly baseUrl?: string;
}

interface AresRuntime {
  readonly fetchImpl: FetchLike;
  readonly now: () => Date;
  readonly timeoutMs: number;
  readonly baseUrl: string;
}

export async function lookupAresCompany(
  input: string,
  options: AresClientOptions = {},
): Promise<AresLookupResult> {
  const runtime: AresRuntime = {
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => new Date()),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_ARES_BASE_URL),
  };
  const validation = validateCzechCompanyId(input);

  if (validation.status === "invalid") {
    return result(runtime, input, validation.normalized, {
      lookupState: "invalid_input",
      status: "invalid",
      action: "warn",
      health: "not_checked",
      detail: validation.issues[0] ?? "company.ico_invalid",
      issues: validation.issues,
    });
  }

  const ico = validation.normalized;
  if (!ico) throw new Error("A valid IČO must have a normalized value.");

  let response: Response;
  try {
    response = await fetchWithTimeout(
      runtime.fetchImpl,
      `${runtime.baseUrl}/ekonomicke-subjekty/${encodeURIComponent(ico)}`,
      { headers: { accept: "application/json" }, method: "GET" },
      runtime.timeoutMs,
    );
  } catch (error) {
    return result(runtime, input, ico, {
      lookupState: "unavailable",
      status: "unknown",
      action: "fail_open",
      health: "unavailable",
      detail: error instanceof ProviderTimeoutError ? "provider.timeout" : "provider.network_error",
      issues: ["company.ares_unavailable"],
    });
  }

  if (response.status === 404) {
    return result(runtime, input, ico, {
      lookupState: "not_found",
      status: "unknown",
      action: "fail_open",
      health: "available",
      httpStatus: response.status,
      detail: "company.ares_not_found",
      issues: ["company.ares_not_found"],
    });
  }

  if (response.status === 429) {
    return result(runtime, input, ico, {
      lookupState: "unavailable",
      status: "unknown",
      action: "fail_open",
      health: "degraded",
      httpStatus: response.status,
      detail: "provider.rate_limited",
      issues: ["company.ares_unavailable"],
    });
  }

  if (response.status >= 500) {
    return result(runtime, input, ico, {
      lookupState: "unavailable",
      status: "unknown",
      action: "fail_open",
      health: "unavailable",
      httpStatus: response.status,
      detail: "provider.server_error",
      issues: ["company.ares_unavailable"],
    });
  }

  if (!response.ok) {
    return result(runtime, input, ico, {
      lookupState: "invalid_response",
      status: "unknown",
      action: "fail_open",
      health: "degraded",
      httpStatus: response.status,
      detail: "provider.rejected_request",
      issues: ["company.ares_invalid_response"],
    });
  }

  let body: unknown;
  try {
    body = await readBoundedJson(response, runtime.timeoutMs);
  } catch (error) {
    if (error instanceof ProviderTimeoutError) {
      return result(runtime, input, ico, {
        lookupState: "unavailable",
        status: "unknown",
        action: "fail_open",
        health: "unavailable",
        httpStatus: response.status,
        detail: "provider.timeout",
        issues: ["company.ares_unavailable"],
      });
    }
    return invalidResponse(runtime, input, ico, response.status);
  }

  const company = parseAresCompany(body, ico);
  if (!company) return invalidResponse(runtime, input, ico, response.status);

  return result(runtime, input, ico, {
    lookupState: "confirmed",
    status: "valid",
    action: "accept",
    health: "available",
    httpStatus: response.status,
    detail: "company.ares_confirmed",
    company,
    issues: [],
  });
}

export async function searchAresCompanies(
  input: string,
  limit = 5,
  options: AresClientOptions = {},
): Promise<AresAutocompleteResult> {
  const runtime: AresRuntime = {
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => new Date()),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_ARES_BASE_URL),
  };
  const query = input.normalize("NFC").trim().replace(/\s+/g, " ");
  const numeric = /^\d+$/.test(query);
  if (query.length < 3 || query.length > 128 || (numeric && query.length !== 8)) {
    return autocompleteResult(runtime, query, "no_match", [], []);
  }
  const body = numeric
    ? { start: 0, pocet: Math.min(5, Math.max(1, limit)), ico: [query] }
    : { start: 0, pocet: Math.min(5, Math.max(1, limit)), obchodniJmeno: query };
  let response: Response;
  try {
    response = await fetchWithTimeout(
      runtime.fetchImpl,
      `${runtime.baseUrl}/ekonomicke-subjekty/vyhledat`,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      runtime.timeoutMs,
    );
  } catch {
    return autocompleteResult(runtime, query, "unavailable", [], ["company.ares_unavailable"]);
  }
  if (!response.ok) {
    return autocompleteResult(
      runtime,
      query,
      response.status === 400 ? "no_match" : "unavailable",
      [],
      response.status === 400 ? [] : ["company.ares_unavailable"],
      response.status,
    );
  }
  let responseBody: unknown;
  try {
    responseBody = await readBoundedJson(response, runtime.timeoutMs, 512 * 1_024);
  } catch {
    return autocompleteResult(runtime, query, "unavailable", [], ["company.ares_invalid_response"]);
  }
  if (!isRecord(responseBody) || !Array.isArray(responseBody.ekonomickeSubjekty)) {
    return autocompleteResult(runtime, query, "unavailable", [], ["company.ares_invalid_response"]);
  }
  const companies = responseBody.ekonomickeSubjekty
    .map((item) => parseAresCompany(item))
    .filter((company): company is AresCompany => company !== null)
    .slice(0, Math.min(5, Math.max(1, limit)));
  return autocompleteResult(
    runtime,
    query,
    companies.length ? "matched" : "no_match",
    companies,
    [],
  );
}

function parseAresCompany(body: unknown, expectedIco?: string): AresCompany | null {
  if (!isRecord(body)) return null;
  const ico = nullableString(body.ico);
  const name = nullableString(body.obchodniJmeno, 512);
  if (!ico || (expectedIco !== undefined && ico !== expectedIco) || !name) return null;

  const seat = isRecord(body.sidlo) ? body.sidlo : null;
  return {
    ico,
    name,
    vat_id: nullableString(body.dic, 32),
    address: seat ? nullableString(seat.textovaAdresa, 1_024) : null,
    address_standardized:
      seat && typeof seat.standardizaceAdresy === "boolean" ? seat.standardizaceAdresy : null,
    updated_at: nullableString(body.datumAktualizace, 64),
    primary_source: nullableString(body.primarniZdroj, 128),
    registered_office: seat ? parseRegisteredOffice(seat) : null,
  };
}

function parseRegisteredOffice(
  seat: Record<string, unknown>,
): NonNullable<AresCompany["registered_office"]> | null {
  const street = nullableString(seat.nazevUlice, 240);
  const houseNumber = numberLikeString(seat.cisloDomovni);
  const orientation = numberLikeString(seat.cisloOrientacni);
  const orientationLetter = nullableString(seat.cisloOrientacniPismeno, 8);
  const city = nullableString(seat.nazevObce, 240);
  const postalCode = numberLikeString(seat.psc ?? seat.kodPsc);
  const country = nullableString(seat.kodStatu, 8);
  if (country && country !== "CZ") return null;
  const number = houseNumber
    ? `${houseNumber}${orientation ? `/${orientation}${orientationLetter ?? ""}` : ""}`
    : null;
  const streetLine = [street, number].filter(Boolean).join(" ") || null;
  if (!streetLine && !city && !postalCode) return null;
  return {
    street_line: streetLine,
    city,
    postal_code: postalCode ? postalCode.padStart(5, "0") : null,
    country: "CZ",
  };
}

function numberLikeString(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return null;
}

function autocompleteResult(
  runtime: AresRuntime,
  input: string,
  status: AresAutocompleteResult["status"],
  companies: readonly AresCompany[],
  issues: readonly string[],
  httpStatus?: number,
): AresAutocompleteResult {
  return {
    object: "company_suggestion_list",
    provider: "ares",
    input,
    status,
    companies,
    issues,
    evidence: [
      {
        source: "ares",
        checked_at: runtime.now().toISOString(),
        state:
          status === "matched" ? "confirmed" : status === "no_match" ? "not_found" : "unavailable",
        health: status === "unavailable" ? "unavailable" : "available",
        ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
      },
    ],
  };
}

function invalidResponse(
  runtime: AresRuntime,
  input: string,
  normalizedIco: string,
  httpStatus: number,
): AresLookupResult {
  return result(runtime, input, normalizedIco, {
    lookupState: "invalid_response",
    status: "unknown",
    action: "fail_open",
    health: "degraded",
    httpStatus,
    detail: "provider.invalid_response",
    issues: ["company.ares_invalid_response"],
  });
}

interface ResultOptions {
  readonly lookupState: ProviderLookupState;
  readonly status: ValidationStatus;
  readonly action: RecommendedAction;
  readonly health: ProviderHealth;
  readonly issues: readonly string[];
  readonly company?: AresCompany;
  readonly httpStatus?: number;
  readonly detail?: string;
}

function result(
  runtime: AresRuntime,
  input: string,
  normalizedIco: string | null,
  options: ResultOptions,
): AresLookupResult {
  return {
    object: "company_lookup_result",
    provider: "ares",
    input,
    normalized_ico: normalizedIco,
    lookup_state: options.lookupState,
    status: options.status,
    recommended_action: options.action,
    company: options.company ?? null,
    issues: options.issues,
    evidence: [
      {
        source: "ares",
        checked_at: runtime.now().toISOString(),
        state: options.lookupState,
        health: options.health,
        ...(options.httpStatus === undefined ? {} : { http_status: options.httpStatus }),
        ...(options.detail === undefined ? {} : { detail: options.detail }),
      },
    ],
  };
}
