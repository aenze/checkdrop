import {
  type CzechAddressComponents,
  normalizeCzechAddressSearch,
  parseCzechStreetNumber,
} from "@checkdrop/pack-cz";
import { Pool, type PoolConfig, type QueryResultRow } from "pg";
import {
  type CachedAddressSearchOptions,
  createCachedAddressSearch,
} from "./address-search-cache.js";
import { interactivePoolOptions } from "./interactive-pool.js";

export interface AddressSuggestion {
  id: string;
  addressLine: string;
  municipality: string;
  municipalityPart: string | null;
  street: string | null;
  houseNumber: string;
  orientationNumber: string | null;
  postalCode: string;
  matchScore: number;
  reasons: string[];
}

export type AddressAdvice =
  | { code: "address.house_number_missing" }
  | { code: "address.postal_code_mismatch"; postal_code: string }
  | { code: "address.no_match" };

export interface AddressSearchResult {
  object: "address_search_result";
  /** Only for searches with separate components; at most one, a confirmed PSČ mismatch first. */
  advice?: AddressAdvice;
  status: "matched" | "unknown";
  input: string;
  normalized: string;
  suggestions: AddressSuggestion[];
  evidence: {
    source: "ruian-st-uads";
    sourceVersion: string | null;
    effectiveAt: string | null;
    state: "confirmed" | "absent";
    /** Internal RÚIAN dataset version that produced the suggestions. */
    datasetVersionId?: string;
  };
}

export interface AddressSearchOptions {
  limit?: number;
  candidateLimit?: number;
  /**
   * Candidate retrieval without a postal code or a recognised municipality. "street-prefix-first"
   * matches what a customer types (street name, then number) through the street trigram index and
   * falls back to whole-address similarity only when the prefix finds nothing, for example after a
   * typo. "trigram" is the previous behaviour, kept for benchmarks.
   */
  strategy?: "street-prefix-first" | "trigram";
  /**
   * Separate street line, city and postal code from the checkout. The postal code is then taken
   * only from its own field, and the result may carry advice about a missing number or a PSČ.
   */
  components?: CzechAddressComponents;
}

export interface AddressSearcher {
  search(input: string, options?: AddressSearchOptions): Promise<AddressSearchResult>;
  close(): Promise<void>;
}

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/** What a pooled searcher adds to a plain query function; a bare queryable keeps the SQL paths. */
export interface AddressSearchContext {
  /** Resolves the longest typed suffix that is a municipality, without a per-keystroke query. */
  readonly resolveCitySuffix?: (suffixes: readonly string[]) => Promise<string | null>;
  /** Runs the whole-address trigram fallback under its own, shorter statement timeout. */
  readonly runFallback?: <R extends QueryResultRow>(
    text: string,
    values: unknown[],
  ) => Promise<{ rows: R[] }>;
}

interface PoolLike {
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: QueryResultRow[] }>;
    release(error?: Error | boolean): void;
  }>;
}

interface CandidateRow extends QueryResultRow {
  id: string;
  municipality: string;
  municipality_part: string | null;
  street: string | null;
  house_number: string;
  orientation_number: string | null;
  postal_code: string;
  address_line: string;
  search_full: string;
  search_postal_code: string;
  trigram_similarity: number;
  dataset_version_id: string;
  source_version: string;
  effective_at: Date;
}

interface CityRow extends QueryResultRow {
  search_city: string;
}

export async function suggestCzechAddresses(
  connectionString: string,
  input: string,
  options: AddressSearchOptions = {},
): Promise<AddressSearchResult> {
  const pool = new Pool({ ...interactivePoolOptions, connectionString });
  try {
    return await searchCzechAddresses(pool, input, options);
  } finally {
    await pool.end();
  }
}

/**
 * Address lookups answer a checkout that gives up after 2.5 s. A longer query only holds one of
 * the pool's connections, so it is cancelled by PostgreSQL and reported as unavailable instead.
 */
export const ADDRESS_SEARCH_STATEMENT_TIMEOUT_MS = 2_000;

/**
 * The whole-address trigram fallback (after a typo, without a PSČ or a recognised municipality)
 * scans the trigram index of every address point and has the slowest tail. It runs in its own
 * transaction under this shorter limit, so it cannot hold a pooled connection for two seconds; a
 * cancelled fallback is reported as unavailable, exactly like any other failed lookup.
 */
export const ADDRESS_SEARCH_FALLBACK_TIMEOUT_MS = 700;

/**
 * Without a postal code or a city, a query shorter than this has no anchor: a prefix of 3–4
 * characters matches thousands of address points and any five of them are arbitrary.
 */
export const ADDRESS_SEARCH_MIN_UNANCHORED_LENGTH = 5;

/** After a failed load of the municipality list, the per-request query is used this long. */
const CITY_INDEX_RETRY_MS = 60_000;

export function addressSearchPoolOptions(
  connectionString: string,
  statementTimeoutMs = ADDRESS_SEARCH_STATEMENT_TIMEOUT_MS,
): PoolConfig {
  return {
    ...interactivePoolOptions,
    connectionString,
    max: 12,
    statement_timeout: statementTimeoutMs,
  };
}

export interface PostgresAddressSearcherOptions {
  readonly statementTimeoutMs?: number;
  readonly fallbackTimeoutMs?: number;
  readonly cache?: CachedAddressSearchOptions;
}

export function createPostgresAddressSearcher(
  connectionString: string,
  options: PostgresAddressSearcherOptions = {},
): AddressSearcher {
  const pool = new Pool(addressSearchPoolOptions(connectionString, options.statementTimeoutMs));
  const fallbackTimeoutMs = options.fallbackTimeoutMs ?? ADDRESS_SEARCH_FALLBACK_TIMEOUT_MS;
  const cities = createCitySuffixIndex(pool, options.cache?.now);
  const runFallback: AddressSearchContext["runFallback"] = (text, values) =>
    queryWithStatementTimeout(pool, fallbackTimeoutMs, text, values);
  const cached = createCachedAddressSearch(
    async () => {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM reference_cz.dataset_versions
          WHERE source = 'ruian-st-uads' AND state = 'active'
          ORDER BY effective_at DESC
          LIMIT 1`,
      );
      return result.rows[0]?.id ?? null;
    },
    (input, searchOptions, datasetId) =>
      searchCzechAddresses(pool, input, searchOptions, {
        runFallback,
        ...(datasetId
          ? { resolveCitySuffix: (suffixes) => cities.resolve(datasetId, suffixes) }
          : {}),
      }),
    options.cache,
  );
  return {
    search: cached.search,
    async close() {
      cached.clear();
      await pool.end();
    },
  };
}

/**
 * Runs one read under `SET LOCAL statement_timeout`, inside its own short transaction, so the limit
 * never leaks to the next user of the pooled connection. Errors, including the cancellation
 * (SQLSTATE 57014), are rethrown for the caller to report as unavailable.
 */
export async function queryWithStatementTimeout<R extends QueryResultRow>(
  pool: PoolLike,
  timeoutMs: number,
  text: string,
  values: unknown[],
): Promise<{ rows: R[] }> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
    const result = await client.query(text, values);
    await client.query("COMMIT");
    return result as { rows: R[] };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

/**
 * The municipalities (normalized `search_city`) of one RÚIAN dataset, kept in memory so that
 * recognising a typed city costs no query per keystroke. The list is loaded once per dataset
 * through an index skip scan; until it is loaded, or if loading fails, the per-request query is
 * used, so a missing list never changes results.
 */
export function createCitySuffixIndex(queryable: Queryable, now = () => performance.now()) {
  let loaded: { readonly datasetId: string; readonly cities: ReadonlySet<string> } | null = null;
  let loading: { readonly datasetId: string; readonly promise: Promise<void> } | null = null;
  let failed: { readonly datasetId: string; readonly at: number } | null = null;

  function load(datasetId: string): Promise<void> {
    if (loading?.datasetId === datasetId) return loading.promise;
    const promise = queryable
      .query<{ search_city: string }>(
        `WITH RECURSIVE cities(search_city) AS (
           (SELECT address.search_city
              FROM reference_cz.addresses AS address
             WHERE address.dataset_version_id = $1
             ORDER BY address.search_city
             LIMIT 1)
           UNION ALL
           SELECT (
             SELECT address.search_city
               FROM reference_cz.addresses AS address
              WHERE address.dataset_version_id = $1
                AND address.search_city > cities.search_city
              ORDER BY address.search_city
              LIMIT 1)
           FROM cities
           WHERE cities.search_city IS NOT NULL
         )
         SELECT search_city FROM cities WHERE search_city IS NOT NULL`,
        [datasetId],
      )
      .then(
        (result) => {
          if (result.rows.length > 0) {
            loaded = { datasetId, cities: new Set(result.rows.map((row) => row.search_city)) };
            failed = null;
          } else {
            failed = { datasetId, at: now() };
          }
        },
        () => {
          failed = { datasetId, at: now() };
        },
      )
      .finally(() => {
        if (loading?.promise === promise) loading = null;
      });
    loading = { datasetId, promise };
    return promise;
  }

  return {
    async resolve(datasetId: string, suffixes: readonly string[]): Promise<string | null> {
      if (loaded?.datasetId !== datasetId) {
        const recentlyFailed =
          failed?.datasetId === datasetId && now() - failed.at < CITY_INDEX_RETRY_MS;
        if (!recentlyFailed) await load(datasetId);
      }
      const current = loaded;
      if (!current || current.datasetId !== datasetId) return queryCitySuffix(queryable, suffixes);
      // Suffixes come longest first, as the query orders them by length.
      return suffixes.find((suffix) => current.cities.has(suffix)) ?? null;
    },
    get datasetId() {
      return loaded?.datasetId ?? null;
    },
  };
}

export async function searchCzechAddresses(
  queryable: Queryable,
  input: string,
  options: AddressSearchOptions = {},
  context: AddressSearchContext = {},
): Promise<AddressSearchResult> {
  const result = await searchCandidates(queryable, input, options, context);
  return options.components
    ? withComponentAdvice(queryable, result, options.components, options, context)
    : result;
}

function componentPostalCode(components: CzechAddressComponents): string | null {
  const compact = components.postal_code.replace(/\s+/g, "");
  return /^\d{5}$/.test(compact) ? compact : null;
}

async function searchCandidates(
  queryable: Queryable,
  input: string,
  options: AddressSearchOptions,
  context: AddressSearchContext,
): Promise<AddressSearchResult> {
  const normalized = normalizeCzechAddressSearch(input);
  if (!normalized) {
    return emptyResult(input, normalized);
  }

  // With components, a five-digit house number in the query can never be mistaken for a PSČ.
  const postalCode = options.components
    ? componentPostalCode(options.components)
    : extractCzechPostalCode(input);
  const inputHouseNumber = extractInputHouseNumber(normalized, postalCode);
  const candidateLimit = clamp(options.candidateLimit ?? 50, 5, 100);
  const limit = clamp(options.limit ?? 5, 1, 10);
  const selectCandidates = `SELECT
      address.id,
      address.municipality,
      address.municipality_part,
      address.street,
      address.house_number,
      address.orientation_number,
      address.postal_code,
      address.address_line,
      address.search_full,
      address.search_postal_code,
      similarity(address.search_full, $1) AS trigram_similarity,
      dataset.id AS dataset_version_id,
      dataset.version AS source_version,
      dataset.effective_at
    FROM reference_cz.addresses_active AS address
    INNER JOIN reference_cz.dataset_versions AS dataset
      ON dataset.id = address.dataset_version_id`;
  let result: { rows: CandidateRow[] };
  if (postalCode) {
    result = await queryable.query<CandidateRow>(
      `${selectCandidates}
         WHERE address.search_postal_code = $2
         ORDER BY similarity(address.search_full, $1) DESC, address.id
         LIMIT $3`,
      [normalized, postalCode, candidateLimit],
    );
  } else if (normalized.length < ADDRESS_SEARCH_MIN_UNANCHORED_LENGTH) {
    // A separate city field still anchors a short query, e.g. a village number "1" in "Aš".
    if (!options.components?.city.trim()) return emptyResult(input, normalized);
    result = await queryable.query<CandidateRow>(
      `${selectCandidates}
       WHERE address.search_full LIKE $2
       ORDER BY address.search_full, address.id
       LIMIT $3`,
      [normalized, `${normalized}%`, candidateLimit],
    );
  } else {
    const city = await resolveCitySuffix(queryable, normalized, context);
    if (city) {
      const streetPrefixes = buildStreetPrefixes(normalized.slice(0, -city.length).trim());
      if (streetPrefixes.length === 0) {
        result = await queryable.query<CandidateRow>(
          `${selectCandidates}
           WHERE address.search_city = $2
           ORDER BY address.id
           LIMIT $3`,
          [normalized, city, candidateLimit],
        );
      } else {
        const prefixPredicates = streetPrefixes.map(
          (_, index) => `address.search_street % $${index + 3}`,
        );
        const prefixScores = streetPrefixes.map(
          (_, index) => `similarity(address.search_street, $${index + 3})`,
        );
        const limitParameter = streetPrefixes.length + 3;
        result = await queryable.query<CandidateRow>(
          `${selectCandidates}
           WHERE address.search_city = $2
             AND (${prefixPredicates.join(" OR ")})
           ORDER BY greatest(${prefixScores.join(", ")}) DESC, address.id
           LIMIT $${limitParameter}`,
          [normalized, city, ...streetPrefixes, candidateLimit],
        );
      }
    } else {
      const streetQuery =
        (options.strategy ?? "street-prefix-first") === "street-prefix-first"
          ? splitStreetQuery(normalized)
          : null;
      // Normalized input holds only [a-z0-9 ], so it cannot contain LIKE wildcards.
      const prefixResult = !streetQuery
        ? null
        : streetQuery.number
          ? await queryable.query<CandidateRow>(
              `${selectCandidates}
               WHERE address.search_street LIKE $2
                 AND (
                   address.house_number LIKE $3
                   OR COALESCE(address.orientation_number, '') LIKE $3
                 )
               ORDER BY
                 (
                   address.house_number = $4
                   OR regexp_replace(COALESCE(address.orientation_number, ''), '[^0-9]', '', 'g') = $4
                 ) DESC,
                 address.search_street,
                 address.id
               LIMIT $5`,
              [
                normalized,
                `${streetQuery.street} %`,
                `${streetQuery.number}%`,
                streetQuery.number,
                candidateLimit,
              ],
            )
          : await queryable.query<CandidateRow>(
              `${selectCandidates}
               WHERE address.search_street LIKE $2
               ORDER BY address.search_street, address.id
               LIMIT $3`,
              [normalized, `${streetQuery.street}%`, candidateLimit],
            );
      const fallback = context.runFallback ?? ((text, values) => queryable.query(text, values));
      if (prefixResult && prefixResult.rows.length > 0) {
        result = prefixResult;
      } else if (inputHouseNumber) {
        result = await fallback<CandidateRow>(
          `${selectCandidates}
           WHERE address.search_full % $1
             AND (
               address.house_number LIKE $2
               OR COALESCE(address.orientation_number, '') LIKE $2
             )
           ORDER BY
             (
               address.house_number = $3
               OR regexp_replace(COALESCE(address.orientation_number, ''), '[^0-9]', '', 'g') = $3
             ) DESC,
             similarity(address.search_full, $1) DESC,
             address.id
           LIMIT $4`,
          [normalized, `${inputHouseNumber}%`, inputHouseNumber, candidateLimit],
        );
      } else {
        result = await fallback<CandidateRow>(
          `${selectCandidates}
           WHERE address.search_full % $1
           ORDER BY similarity(address.search_full, $1) DESC, address.id
           LIMIT $2`,
          [normalized, candidateLimit],
        );
      }
    }
  }

  if (result.rows.length === 0) {
    return emptyResult(input, normalized);
  }

  const suggestions = result.rows
    .map((candidate) => scoreCandidate(candidate, normalized, postalCode))
    .filter((candidate) => candidate.matchScore >= 0.25)
    .sort((left, right) => right.matchScore - left.matchScore || left.id.localeCompare(right.id))
    .slice(0, limit);
  const dataset = result.rows[0];

  return {
    object: "address_search_result",
    status: suggestions.length > 0 ? "matched" : "unknown",
    input,
    normalized,
    suggestions,
    evidence: {
      source: "ruian-st-uads",
      sourceVersion: dataset?.source_version ?? null,
      effectiveAt: dataset?.effective_at.toISOString() ?? null,
      state: "confirmed",
      ...(dataset ? { datasetVersionId: dataset.dataset_version_id } : {}),
    },
  };
}

interface ExactRow extends QueryResultRow {
  id: string;
  dataset_version_id: string;
  municipality: string;
  municipality_part: string | null;
  street: string | null;
  house_number: string;
  orientation_number: string | null;
  postal_code: string;
  address_line: string;
}

/**
 * Adds advice for a checkout address given as separate fields. A PSČ correction is proposed only
 * when the street (or a village without streets), the house number, the orientation number if
 * typed and the municipality match exactly one address point. Several matches keep the ordinary
 * suggestions without claiming the PSČ is wrong. Database errors are not caught here, so the
 * caller reports the lookup as unavailable instead of as no match.
 */
async function withComponentAdvice(
  queryable: Queryable,
  initial: AddressSearchResult,
  components: CzechAddressComponents,
  options: AddressSearchOptions,
  context: AddressSearchContext,
): Promise<AddressSearchResult> {
  let result = initial;
  const parsed = parseCzechStreetNumber(components.street_line);
  const city = normalizeCzechAddressSearch(components.city);
  const postalCode = componentPostalCode(components);
  const sameStreet = (street: string | null) =>
    parsed?.street
      ? normalizeCzechAddressSearch(street ?? "") === normalizeCzechAddressSearch(parsed.street)
      : street === null;
  const exact = (suggestion: AddressSuggestion) =>
    Boolean(parsed) &&
    normalizeCzechAddressSearch(suggestion.municipality) === city &&
    sameStreet(suggestion.street) &&
    suggestion.houseNumber === parsed?.houseNumber &&
    (!parsed?.orientationNumber ||
      suggestion.orientationNumber?.toLowerCase() === parsed.orientationNumber);

  if (parsed && city) {
    if (postalCode && result.suggestions.some((s) => exact(s) && s.postalCode === postalCode)) {
      return result;
    }
    const streetKey = parsed.street
      ? `${normalizeCzechAddressSearch(parsed.street)} ${parsed.houseNumber}`
      : null;
    const rows = (
      await queryable.query<ExactRow>(
        `SELECT id, dataset_version_id, municipality, municipality_part, street, house_number,
                orientation_number, postal_code, address_line
           FROM reference_cz.addresses_active
          WHERE search_city = $1
            AND house_number = $2
            AND (
              ($3::text IS NULL AND street IS NULL)
              OR search_street = $3
              OR search_street LIKE $3 || ' %'
            )
            AND ($4::text IS NULL OR lower(orientation_number) = $4)
            AND ($5::text IS NULL OR dataset_version_id = $5)
          ORDER BY id
          LIMIT 5`,
        [
          city,
          parsed.houseNumber,
          streetKey,
          parsed.orientationNumber,
          result.evidence.datasetVersionId ?? null,
        ],
      )
    ).rows;
    const toSuggestion = (row: ExactRow, reasons: string[]): AddressSuggestion => ({
      id: row.id,
      addressLine: row.address_line,
      municipality: row.municipality,
      municipalityPart: row.municipality_part,
      street: row.street,
      houseNumber: row.house_number,
      orientationNumber: row.orientation_number,
      postalCode: row.postal_code,
      matchScore: 1,
      reasons,
    });
    // Suggestions must carry the dataset they came from, or the cache treats them as a rotation.
    const evidenceFrom = (row: ExactRow) => ({
      ...result.evidence,
      state: "confirmed" as const,
      datasetVersionId: row.dataset_version_id,
    });
    const only = rows.length === 1 ? rows[0] : undefined;
    if (postalCode && only && only.postal_code.replace(/\s+/g, "") !== postalCode) {
      return {
        ...result,
        status: "matched",
        suggestions: [
          toSuggestion(only, ["address.exact_street_number_city", "address.postal_code_differs"]),
        ],
        evidence: evidenceFrom(only),
        advice: { code: "address.postal_code_mismatch", postal_code: only.postal_code },
      };
    }
    const first = rows[0];
    if (first && !result.suggestions.some(exact)) {
      // Exact address points first, for example a village number that the text search misses.
      result = {
        ...result,
        status: "matched",
        suggestions: rows
          .map((row) => toSuggestion(row, ["address.exact_street_number_city"]))
          .slice(0, options.limit ?? 5),
        evidence: evidenceFrom(first),
      };
    } else if (postalCode) {
      // A wrong PSČ narrows the ordinary search to another area. When nothing there belongs to the
      // typed street and municipality, search once more without the PSČ, without claiming it.
      const typedStreetFound = result.suggestions.some(
        (s) => sameStreet(s.street) && normalizeCzechAddressSearch(s.municipality) === city,
      );
      if (!typedStreetFound) {
        const withoutPostalCode = await searchCandidates(
          queryable,
          `${components.street_line} ${components.city}`,
          { ...options, components: { ...components, postal_code: "" } },
          context,
        );
        if (withoutPostalCode.suggestions.length > 0) result = withoutPostalCode;
      }
    }
  }

  const streetOnly = normalizeCzechAddressSearch(components.street_line);
  if (
    !parsed &&
    streetOnly &&
    city &&
    result.suggestions.some(
      (s) =>
        normalizeCzechAddressSearch(s.street ?? "") === streetOnly &&
        normalizeCzechAddressSearch(s.municipality) === city,
    )
  ) {
    return { ...result, advice: { code: "address.house_number_missing" } };
  }
  if (result.suggestions.length === 0) return { ...result, advice: { code: "address.no_match" } };
  return result;
}

/**
 * Splits typed input into a street name and the first number after it. A number inside the street
 * name ("17 listopadu 12") stays part of the name because the name ends with its last word.
 */
export function splitStreetQuery(
  normalized: string,
): { street: string; number: string | null } | null {
  const tokens = normalized.split(" ").filter(Boolean);
  let lastWord = -1;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (/^[a-z]/.test(tokens[index] ?? "")) {
      lastWord = index;
      break;
    }
  }
  if (lastWord < 0) return null;
  const street = tokens.slice(0, lastWord + 1).join(" ");
  const number = tokens.slice(lastWord + 1).find((token) => /^\d/.test(token)) ?? null;
  return { street, number: number?.match(/^\d+/)?.[0] ?? null };
}

function buildStreetPrefixes(inputWithoutCity: string): string[] {
  const tokens = inputWithoutCity.split(" ").filter(Boolean);
  const numericTokenIndexes = tokens
    .map((token, index) => (/^\d+[a-z]?$/.test(token) ? index : -1))
    .filter((index) => index >= 0)
    .slice(-3);
  const prefixes = numericTokenIndexes.map((index) => tokens.slice(0, index + 1).join(" "));
  if (prefixes.length === 0 && inputWithoutCity) {
    prefixes.push(inputWithoutCity);
  }
  return [...new Set(prefixes)];
}

async function resolveCitySuffix(
  queryable: Queryable,
  normalizedInput: string,
  context: AddressSearchContext,
): Promise<string | null> {
  const tokens = normalizedInput.split(" ");
  const suffixes: string[] = [];
  for (let wordCount = Math.min(3, tokens.length); wordCount >= 1; wordCount -= 1) {
    const suffix = tokens.slice(-wordCount).join(" ");
    if (/^[a-z]/.test(suffix)) {
      suffixes.push(suffix);
    }
  }
  if (suffixes.length === 0) {
    return null;
  }
  return context.resolveCitySuffix
    ? context.resolveCitySuffix(suffixes)
    : queryCitySuffix(queryable, suffixes);
}

async function queryCitySuffix(
  queryable: Queryable,
  suffixes: readonly string[],
): Promise<string | null> {
  const result = await queryable.query<CityRow>(
    `SELECT address.search_city
     FROM reference_cz.addresses_active AS address
     WHERE address.search_city = ANY($1::text[])
     GROUP BY address.search_city
     ORDER BY length(address.search_city) DESC
     LIMIT 1`,
    [suffixes],
  );
  return result.rows[0]?.search_city ?? null;
}

function scoreCandidate(
  candidate: CandidateRow,
  normalizedInput: string,
  postalCode: string | null,
): AddressSuggestion {
  const reasons: string[] = ["address.trigram_candidate"];
  const inputTokens = new Set(normalizedInput.split(" "));
  const candidateTokens = new Set(candidate.search_full.split(" "));
  const matchingTokens = [...inputTokens].filter((token) => candidateTokens.has(token)).length;
  const tokenCoverage = inputTokens.size > 0 ? matchingTokens / inputTokens.size : 0;
  let score = Number(candidate.trigram_similarity) * 0.65 + tokenCoverage * 0.25;
  const inputHouseNumber = extractInputHouseNumber(normalizedInput, postalCode);

  if (candidate.search_full === normalizedInput) {
    score += 0.2;
    reasons.push("address.exact_normalized_match");
  } else if (candidate.search_full.startsWith(normalizedInput)) {
    score += 0.25;
    reasons.push("address.prefix_match");
  }
  if (postalCode && candidate.search_postal_code === postalCode) {
    score += 0.15;
    reasons.push("address.postal_code_match");
  }
  if (inputHouseNumber) {
    const orientationNumber = candidate.orientation_number?.replace(/[^0-9]/g, "") ?? null;
    if (candidate.house_number === inputHouseNumber || orientationNumber === inputHouseNumber) {
      score += 0.3;
      reasons.push("address.house_number_match");
    } else {
      score -= 0.2;
      reasons.push("address.house_number_mismatch");
    }
  }
  if (tokenCoverage === 1) {
    reasons.push("address.all_tokens_match");
  }

  return {
    id: candidate.id,
    addressLine: candidate.address_line,
    municipality: candidate.municipality,
    municipalityPart: candidate.municipality_part,
    street: candidate.street,
    houseNumber: candidate.house_number,
    orientationNumber: candidate.orientation_number,
    postalCode: candidate.postal_code,
    matchScore: Math.round(Math.min(1, score) * 10_000) / 10_000,
    reasons,
  };
}

function extractInputHouseNumber(
  normalizedInput: string,
  postalCode: string | null,
): string | null {
  for (const token of normalizedInput.split(" ")) {
    const numeric = token.match(/^(\d{1,4})(?:\/\d{1,4}[a-z]?)?[a-z]?$/)?.[1];
    if (numeric && numeric !== postalCode) return numeric;
  }
  return null;
}

export function extractCzechPostalCode(input: string): string | null {
  const compactMatches = [...input.matchAll(/(?<!\d)([1-7]\d{4})(?!\d)/g)];
  const compact = compactMatches.at(-1)?.[1];
  if (compact) {
    return compact;
  }

  const spacedAtStart = /^\s*([1-7]\d{2})\s(\d{2})(?!\d)/.exec(input);
  if (spacedAtStart?.[1] && spacedAtStart[2]) {
    return `${spacedAtStart[1]}${spacedAtStart[2]}`;
  }
  const spacedAtEnd = /(?:^|\D)([1-7]\d{2})\s(\d{2})\s*$/.exec(input);
  return spacedAtEnd?.[1] && spacedAtEnd[2] ? `${spacedAtEnd[1]}${spacedAtEnd[2]}` : null;
}

function emptyResult(input: string, normalized: string): AddressSearchResult {
  return {
    object: "address_search_result",
    status: "unknown",
    input,
    normalized,
    suggestions: [],
    evidence: {
      source: "ruian-st-uads",
      sourceVersion: null,
      effectiveAt: null,
      state: "absent",
    },
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
