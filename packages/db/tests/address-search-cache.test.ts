import { describe, expect, it, vi } from "vitest";
import type { AddressSearchResult } from "../src/address-search.js";
import {
  AddressLookupUnavailable,
  createCachedAddressSearch,
} from "../src/address-search-cache.js";

function result(
  datasetVersionId: string,
  input = "Sokolska 134",
  empty = false,
): AddressSearchResult {
  return {
    object: "address_search_result",
    status: empty ? "unknown" : "matched",
    input,
    normalized: "sokolska 134",
    suggestions: empty
      ? []
      : [
          {
            id: "1",
            addressLine: "Sokolská 134, 27201 Lhota",
            municipality: "Lhota",
            municipalityPart: null,
            street: "Sokolská",
            houseNumber: "134",
            orientationNumber: null,
            postalCode: "27201",
            matchScore: 0.9,
            reasons: ["street"],
          },
        ],
    evidence: {
      source: "ruian-st-uads",
      sourceVersion: "2026-08-03",
      effectiveAt: "2026-08-03T00:00:00.000Z",
      state: empty ? "absent" : "confirmed",
      ...(empty ? {} : { datasetVersionId }),
    },
  };
}

describe("RÚIAN suggestion cache", () => {
  it("reuses one search for the same dataset, query and limits within 15 minutes", async () => {
    let now = 0;
    const search = vi.fn(async (input: string) => result("v1", input));
    const cache = createCachedAddressSearch(async () => "v1", search, { now: () => now });
    const first = await cache.search("Sokolská 134");
    const second = await cache.search("  sokolska 134 ");
    expect(search).toHaveBeenCalledTimes(1);
    expect(second.suggestions).toEqual(first.suggestions);
    expect(second.input).toBe("  sokolska 134 ");
    now = 15 * 60_000 - 1;
    await cache.search("Sokolská 134");
    expect(search).toHaveBeenCalledTimes(1);
    now = 15 * 60_000 + 1;
    await cache.search("Sokolská 134");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("keeps up to 5 000 suggestion lists and evicts the least recently used", async () => {
    const search = vi.fn(async (input: string) => result("v1", input));
    const cache = createCachedAddressSearch(async () => "v1", search);
    for (let index = 0; index < 5_001; index += 1) await cache.search(`Ulice ${index}`);
    expect(search).toHaveBeenCalledTimes(5_001);
    await cache.search("Ulice 5000");
    await cache.search("Ulice 1");
    expect(search).toHaveBeenCalledTimes(5_001);
    await cache.search("Ulice 0");
    expect(search).toHaveBeenCalledTimes(5_002);
  });

  it("misses on a different limit, candidate limit or dataset", async () => {
    let now = 0;
    let dataset = "v1";
    const search = vi.fn(async (input: string) => result(dataset, input));
    const cache = createCachedAddressSearch(async () => dataset, search, { now: () => now });
    await cache.search("Sokolská 134", { limit: 5 });
    await cache.search("Sokolská 134", { limit: 3 });
    await cache.search("Sokolská 134", { limit: 5, candidateLimit: 75 });
    dataset = "v2";
    now = 60_001;
    const rotated = await cache.search("Sokolská 134", { limit: 5 });
    expect(search).toHaveBeenCalledTimes(4);
    expect(rotated.evidence.datasetVersionId).toBe("v2");
  });

  it("reads the active dataset at most once a minute, also for concurrent requests", async () => {
    let now = 0;
    const activeDatasetId = vi.fn(async () => "v1");
    const search = vi.fn(async (input: string) => result("v1", input));
    const cache = createCachedAddressSearch(activeDatasetId, search, { now: () => now });
    await Promise.all([cache.search("Sokolská 134"), cache.search("Jiná 5")]);
    await cache.search("Sokolská 134");
    await cache.search("Třetí 7");
    expect(activeDatasetId).toHaveBeenCalledTimes(1);
    now = 60_001;
    await cache.search("Sokolská 134");
    expect(activeDatasetId).toHaveBeenCalledTimes(2);
  });

  it("passes the dataset it expects to the search", async () => {
    const search = vi.fn(async (input: string) => result("v1", input));
    const cache = createCachedAddressSearch(async () => "v1", search);
    await cache.search("Sokolská 134", { limit: 3 });
    expect(search).toHaveBeenCalledWith("Sokolská 134", { limit: 3 }, "v1");
  });

  it("after a rotation, serves a hit for at most a minute and rotates on the first miss", async () => {
    let now = 0;
    let dataset = "v1";
    const activeDatasetId = vi.fn(async () => dataset);
    const search = vi.fn(async (input: string) => result(dataset, input));
    const cache = createCachedAddressSearch(activeDatasetId, search, { now: () => now });
    await cache.search("Sokolská 134");
    dataset = "v2";
    now = 30_000;
    // A hit within the dataset ID lifetime may still come from the previous dataset.
    expect((await cache.search("Sokolská 134")).evidence.datasetVersionId).toBe("v1");
    // A miss sees v2 in its own result, confirms it in the database and is not cached.
    expect((await cache.search("Jiná 5")).evidence.datasetVersionId).toBe("v2");
    expect(activeDatasetId).toHaveBeenCalledTimes(2);
    // The next request starts the v2 generation, so the old hit is gone.
    expect((await cache.search("Sokolská 134")).evidence.datasetVersionId).toBe("v2");
    expect(search).toHaveBeenCalledTimes(4);
  });

  it("serves the new dataset after a minute even without a miss", async () => {
    let now = 0;
    let dataset = "v1";
    const search = vi.fn(async (input: string) => result(dataset, input));
    const cache = createCachedAddressSearch(async () => dataset, search, { now: () => now });
    await cache.search("Sokolská 134");
    dataset = "v2";
    now = 60_001;
    expect((await cache.search("Sokolská 134")).evidence.datasetVersionId).toBe("v2");
  });

  it("shares a search in flight and returns independent copies", async () => {
    let release!: (value: AddressSearchResult) => void;
    const search = vi.fn(
      () =>
        new Promise<AddressSearchResult>((resolve) => {
          release = resolve;
        }),
    );
    const cache = createCachedAddressSearch(async () => "v1", search);
    const requests = [cache.search("Sokolská 134"), cache.search("Sokolská 134")];
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    release(result("v1"));
    const [first, second] = await Promise.all(requests);
    if (!first?.suggestions[0] || !second?.suggestions[0]) throw new Error("missing suggestion");
    first.suggestions[0].postalCode = "00000";
    expect(second.suggestions[0].postalCode).toBe("27201");
    const third = await cache.search("Sokolská 134");
    expect(third.suggestions[0]?.postalCode).toBe("27201");
  });

  it("never stores empty results or errors", async () => {
    const search = vi
      .fn<(input: string) => Promise<AddressSearchResult>>()
      .mockResolvedValueOnce(result("v1", "x", true))
      .mockRejectedValueOnce(new Error("database down"))
      .mockResolvedValue(result("v1"));
    const cache = createCachedAddressSearch(async () => "v1", search);
    expect((await cache.search("Sokolská 134")).suggestions).toEqual([]);
    await expect(cache.search("Sokolská 134")).rejects.toThrow("database down");
    await cache.search("Sokolská 134");
    await cache.search("Sokolská 134");
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("retries once when the dataset rotates during a search and does not cache it", async () => {
    const ids = ["v1", "v2", "v2", "v2"];
    const activeDatasetId = vi.fn(async () => ids.shift() ?? "v2");
    const search = vi.fn(async (input: string) => result("v2", input));
    const cache = createCachedAddressSearch(activeDatasetId, search);
    const retried = await cache.search("Sokolská 134");
    expect(retried.evidence.datasetVersionId).toBe("v2");
    expect(search).toHaveBeenCalledTimes(2);
    await cache.search("Sokolská 134");
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("reports unavailable when the dataset keeps changing", async () => {
    const ids = ["v1", "v2"];
    const search = vi.fn(async () => result("v3"));
    const cache = createCachedAddressSearch(async () => ids.shift() ?? "v4", search);
    await expect(cache.search("Sokolská 134")).rejects.toBeInstanceOf(AddressLookupUnavailable);
  });

  it("does not let an old generation fill the cache after rotation", async () => {
    let dataset = "v1";
    let release!: (value: AddressSearchResult) => void;
    const search = vi
      .fn<(input: string) => Promise<AddressSearchResult>>()
      .mockImplementationOnce(
        () =>
          new Promise<AddressSearchResult>((resolve) => {
            release = resolve;
          }),
      )
      .mockImplementation(async (input) => result(dataset, input));
    let now = 0;
    const cache = createCachedAddressSearch(async () => dataset, search, { now: () => now });
    const old = cache.search("Sokolská 134");
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    dataset = "v2";
    now = 60_001;
    await cache.search("Sokolská 134");
    release(result("v1"));
    await old;
    const fresh = await cache.search("Sokolská 134");
    expect(fresh.evidence.datasetVersionId).toBe("v2");
  });

  it("answers unavailable instead of queueing beyond the in-flight limit", async () => {
    const search = vi.fn(() => new Promise<AddressSearchResult>(() => undefined));
    const cache = createCachedAddressSearch(async () => "v1", search, { maxInFlight: 1 });
    void cache.search("Sokolská 134");
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await expect(cache.search("Jiná 5")).rejects.toBeInstanceOf(AddressLookupUnavailable);
  });

  it("searches without caching when no dataset is active", async () => {
    const search = vi.fn(async () => result("v1", "x", true));
    const cache = createCachedAddressSearch(async () => null, search);
    await cache.search("Sokolská 134");
    await cache.search("Sokolská 134");
    expect(search).toHaveBeenCalledTimes(2);
  });
});
