import { normalizeCzechAddressSearch } from "@checkdrop/pack-cz";
import type { AddressSearchOptions, AddressSearchResult } from "./address-search.js";

/** Bump when ranking or candidate rules change, so cached suggestions are never reused. */
export const ADDRESS_SEARCH_RULES_VERSION = "address-v4";

export interface CachedAddressSearchOptions {
  readonly now?: () => number;
  /** Lifetime of one cached suggestion list; the key already pins the dataset and the rules. */
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly maxInFlight?: number;
  /** How long the active dataset ID is trusted before it is read again. */
  readonly datasetIdTtlMs?: number;
}

type Search = (
  input: string,
  options: AddressSearchOptions | undefined,
  datasetId: string | null,
) => Promise<AddressSearchResult>;

export class AddressLookupUnavailable extends Error {
  constructor() {
    super("Address lookup unavailable");
  }
}

/**
 * In-process cache of RÚIAN suggestion data.
 *
 * The key contains the active dataset ID, the normalized query, limits and the rules version.
 * Empty results and errors are never stored, so the API keeps reporting no_match and
 * unavailable truthfully. A dataset rotation drops the previous generation, and a late answer from
 * an old generation cannot fill the new one. Callers receive a copy carrying their own raw input;
 * request IDs and response envelopes are never cached here.
 *
 * The active dataset ID itself is read at most once per `datasetIdTtlMs`, not per keystroke. After
 * a rotation, a cache hit may therefore serve the previous dataset for at most that long, while
 * the first miss notices the new dataset in its own result, reads the ID again and rotates the
 * cache at once. Monthly RÚIAN rotations keep the previous dataset archived, not deleted.
 */
export function createCachedAddressSearch(
  activeDatasetId: () => Promise<string | null>,
  search: Search,
  options: CachedAddressSearchOptions = {},
) {
  const now = options.now ?? (() => performance.now());
  const ttlMs = options.ttlMs ?? 15 * 60_000;
  const maxEntries = options.maxEntries ?? 5_000;
  const maxInFlight = options.maxInFlight ?? 128;
  const datasetIdTtlMs = options.datasetIdTtlMs ?? 60_000;
  let generation: string | null = null;
  let knownDatasetId: { readonly id: string | null; readonly readAt: number } | null = null;
  let datasetIdRead: Promise<string | null> | null = null;

  /** Reads the active dataset ID; concurrent reads share one query. */
  function readDatasetId(): Promise<string | null> {
    if (datasetIdRead) return datasetIdRead;
    const readAt = now();
    const read = activeDatasetId()
      .then((id) => {
        knownDatasetId = { id, readAt };
        return id;
      })
      .finally(() => {
        if (datasetIdRead === read) datasetIdRead = null;
      });
    datasetIdRead = read;
    return read;
  }

  async function currentDatasetId(): Promise<string | null> {
    if (knownDatasetId && now() - knownDatasetId.readAt < datasetIdTtlMs) return knownDatasetId.id;
    return readDatasetId();
  }

  /** Always queries, so a rotation seen in a result is confirmed by the database itself. */
  async function freshDatasetId(): Promise<string | null> {
    const readAt = now();
    const id = await activeDatasetId();
    knownDatasetId = { id, readAt };
    return id;
  }
  const completed = new Map<string, { readonly expiresAt: number; result: AddressSearchResult }>();
  const inFlight = new Map<string, Promise<AddressSearchResult>>();

  const copyFor = (result: AddressSearchResult, input: string): AddressSearchResult => ({
    ...structuredClone(result),
    input,
  });

  async function load(
    datasetId: string,
    key: string,
    input: string,
    searchOptions: AddressSearchOptions | undefined,
  ) {
    const result = await search(input, searchOptions, datasetId);
    if (result.suggestions.length === 0) return result;
    if (result.evidence.datasetVersionId === datasetId) {
      if (generation === datasetId) {
        completed.delete(key);
        completed.set(key, { expiresAt: now() + ttlMs, result: structuredClone(result) });
        while (completed.size > maxEntries) {
          const oldest = completed.keys().next().value;
          if (oldest === undefined) break;
          completed.delete(oldest);
        }
      }
      return result;
    }
    // The dataset rotated since its ID was read. Read it again and retry once, without caching;
    // the next request then starts the new generation.
    const rotatedId = await freshDatasetId();
    const retried = await search(input, searchOptions, rotatedId);
    if (
      retried.suggestions.length === 0 ||
      (rotatedId !== null && retried.evidence.datasetVersionId === rotatedId)
    )
      return retried;
    throw new AddressLookupUnavailable();
  }

  return {
    async search(input: string, searchOptions?: AddressSearchOptions) {
      const datasetId = await currentDatasetId();
      if (datasetId === null) return search(input, searchOptions, null);
      if (generation !== datasetId) {
        generation = datasetId;
        completed.clear();
        inFlight.clear();
      }
      const key = JSON.stringify({
        datasetId,
        country: "CZ",
        normalizedQuery: normalizeCzechAddressSearch(input),
        components: searchOptions?.components ?? null,
        limit: searchOptions?.limit ?? 5,
        candidateLimit: searchOptions?.candidateLimit ?? 50,
        strategy: searchOptions?.strategy ?? "street-prefix-first",
        rulesVersion: ADDRESS_SEARCH_RULES_VERSION,
      });
      const cached = completed.get(key);
      if (cached) {
        completed.delete(key);
        if (cached.expiresAt > now()) {
          completed.set(key, cached);
          return copyFor(cached.result, input);
        }
      }
      const pending = inFlight.get(key);
      if (pending) return copyFor(await pending, input);
      if (inFlight.size >= maxInFlight) throw new AddressLookupUnavailable();
      const request = load(datasetId, key, input, searchOptions).finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
      inFlight.set(key, request);
      return copyFor(await request, input);
    },
    clear() {
      completed.clear();
      inFlight.clear();
      knownDatasetId = null;
    },
  };
}
