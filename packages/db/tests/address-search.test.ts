import { describe, expect, it, vi } from "vitest";
import {
  createCitySuffixIndex,
  extractCzechPostalCode,
  queryWithStatementTimeout,
  searchCzechAddresses,
  splitStreetQuery,
} from "../src/address-search.js";

describe("Czech postal-code extraction", () => {
  it("prefers an explicit compact postal code over house-number pairs", () => {
    expect(extractCzechPostalCode("Zátiší 103 11 Děčín 40502")).toBe("40502");
  });

  it("does not confuse an internal house/orientation pair with a postal code", () => {
    expect(extractCzechPostalCode("Zátiší 104 13 Děčín XXI Horní Oldřichov Děčín")).toBeNull();
  });

  it("accepts spaced postal codes at an unambiguous boundary", () => {
    expect(extractCzechPostalCode("407 21 Česká Kamenice")).toBe("40721");
    expect(extractCzechPostalCode("Děčínská 3, Česká Kamenice, 407 21")).toBe("40721");
  });
});

describe("Czech address autocomplete ranking", () => {
  it("prioritizes an exact house or orientation number over a longer numeric prefix", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const result = await searchCzechAddresses(
      {
        async query(text, values = []) {
          calls.push({ text, values });
          if (text.includes("GROUP BY address.search_city")) return { rows: [] };
          return {
            rows: [
              candidate({
                id: "prefix-1999",
                house_number: "1999",
                orientation_number: null,
                address_line: "Karlovo náměstí 1999, 547 01 Náchod",
                search_full: "karlovo namesti 1999 nachod 54701",
                trigram_similarity: 0.65,
              }),
              candidate({
                id: "exact-19",
                house_number: "285",
                orientation_number: "19",
                address_line: "Karlovo náměstí 285/19, Nové Město, 120 00 Praha 2",
                search_full: "karlovo namesti 285 19 nove mesto praha 12000",
                trigram_similarity: 0.6,
              }),
            ],
          };
        },
      },
      "Karlovo náměstí 19",
      { strategy: "trigram" },
    );

    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual([
      "exact-19",
      "prefix-1999",
    ]);
    expect(calls[1]?.values).toEqual(["karlovo namesti 19", "19%", "19", 50]);
  });

  it("splits typed input into the street name and the first number after it", () => {
    expect(splitStreetQuery("stani")).toEqual({ street: "stani", number: null });
    expect(splitStreetQuery("hruskova 16")).toEqual({ street: "hruskova", number: "16" });
    expect(splitStreetQuery("karlovo namesti 285 19")).toEqual({
      street: "karlovo namesti",
      number: "285",
    });
    expect(splitStreetQuery("17 listopadu 12")).toEqual({ street: "17 listopadu", number: "12" });
    expect(splitStreetQuery("dlouha 555 54a")).toEqual({ street: "dlouha", number: "555" });
    expect(splitStreetQuery("134")).toBeNull();
  });

  it("finds a street by name and number, including an orientation-only number", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const result = await searchCzechAddresses(
      {
        async query(text, values = []) {
          calls.push({ text, values });
          if (text.includes("GROUP BY address.search_city")) return { rows: [] };
          return {
            rows: [
              candidate({
                id: "exact-19",
                house_number: "285",
                orientation_number: "19",
                address_line: "Karlovo náměstí 285/19, Nové Město, 120 00 Praha 2",
                search_full: "karlovo namesti 285 19 nove mesto praha 12000",
                trigram_similarity: 0.6,
              }),
            ],
          };
        },
      },
      "Karlovo náměstí 19",
    );
    expect(result.suggestions[0]?.id).toBe("exact-19");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.text).toContain("address.search_street LIKE $2");
    expect(calls[1]?.values).toEqual(["karlovo namesti 19", "karlovo namesti %", "19%", "19", 50]);
  });

  it("falls back to whole-address similarity when the street prefix finds nothing", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    await searchCzechAddresses(
      {
        async query(text, values = []) {
          calls.push({ text, values });
          return { rows: [] };
        },
      },
      "Hruskva 1643",
    );
    expect(calls.map((call) => call.values[1])).toEqual([undefined, "hruskva %", "1643%"]);
    expect(calls[2]?.text).toContain("address.search_full % $1");
  });

  it("returns no suggestions for 3–4 characters without a postal code or a city", async () => {
    const calls: string[] = [];
    const queryable = {
      async query(text: string) {
        calls.push(text);
        return { rows: [candidate()] };
      },
    };
    for (const input of ["Kar", "kar.", "Na 1", "Aš 1"]) {
      const result = await searchCzechAddresses(queryable, input);
      expect(result.status).toBe("unknown");
      expect(result.suggestions).toEqual([]);
      expect(result.evidence.state).toBe("absent");
    }
    expect(calls).toEqual([]);
  });

  it("keeps the prefix search for a short query anchored by a separate city", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const result = await searchCzechAddresses(
      {
        async query(text, values = []) {
          calls.push({ text, values });
          return {
            rows: text.includes("search_full LIKE")
              ? [candidate({ id: "village-1", search_full: "1 as 35201", house_number: "1" })]
              : [],
          };
        },
      },
      "1 Aš",
      { components: { street_line: "1", city: "Aš", postal_code: "" } },
    );
    expect(calls[0]?.text).toContain("address.search_full LIKE $2");
    expect(calls[0]?.values).toEqual(["1 as", "1 as%", 50]);
    expect(result.suggestions[0]?.id).toBe("village-1");
  });

  it("still searches a short query by its postal code", async () => {
    const calls: string[] = [];
    await searchCzechAddresses(
      {
        async query(text) {
          calls.push(text);
          return { rows: [] };
        },
      },
      "40714",
    );
    expect(calls[0]).toContain("address.search_postal_code = $2");
  });

  it("resolves a typed city through the context instead of a query", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const resolveCitySuffix = vi.fn(async (suffixes: readonly string[]) =>
      suffixes.includes("ceska kamenice") ? "ceska kamenice" : null,
    );
    await searchCzechAddresses(
      {
        async query(text, values = []) {
          calls.push({ text, values });
          return { rows: [] };
        },
      },
      "Děčínská 3 Česká Kamenice",
      {},
      { resolveCitySuffix },
    );
    expect(resolveCitySuffix).toHaveBeenCalledWith(["ceska kamenice", "kamenice"]);
    expect(calls.some((call) => call.text.includes("GROUP BY address.search_city"))).toBe(false);
    expect(calls[0]?.text).toContain("address.search_city = $2");
    expect(calls[0]?.values.slice(0, 3)).toEqual([
      "decinska 3 ceska kamenice",
      "ceska kamenice",
      "decinska 3",
    ]);
  });

  it("runs only the whole-address fallback through the context's limited runner", async () => {
    const plain: string[] = [];
    const limited: Array<{ text: string; values: unknown[] }> = [];
    const runFallback = async <R>(text: string, values: unknown[]) => {
      limited.push({ text, values });
      return { rows: [] as R[] };
    };
    const queryable = {
      async query(text: string) {
        plain.push(text);
        return { rows: [] };
      },
    };
    await searchCzechAddresses(queryable, "Hruskva 1643", {}, { runFallback });
    await searchCzechAddresses(queryable, "Hruskvaa", {}, { runFallback });
    expect(limited.map((call) => call.values[0])).toEqual(["hruskva 1643", "hruskvaa"]);
    expect(limited.every((call) => call.text.includes("address.search_full % $1"))).toBe(true);
    expect(plain.some((text) => text.includes("address.search_full % $1"))).toBe(false);
  });
});

describe("statement timeout for the slow fallback", () => {
  function fakePool(failing?: Error) {
    const statements: string[] = [];
    const released: Array<Error | boolean | undefined> = [];
    return {
      statements,
      released,
      pool: {
        async connect() {
          return {
            async query(text: string) {
              statements.push(text);
              if (failing && text.startsWith("SELECT")) throw failing;
              return { rows: text.startsWith("SELECT") ? [{ id: "1" }] : [] };
            },
            release(error?: Error | boolean) {
              released.push(error);
            },
          };
        },
      },
    };
  }

  it("limits one query inside its own read-only transaction", async () => {
    const { pool, statements, released } = fakePool();
    const result = await queryWithStatementTimeout(pool, 700, "SELECT 1", []);
    expect(result.rows).toEqual([{ id: "1" }]);
    expect(statements).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = 700",
      "SELECT 1",
      "COMMIT",
    ]);
    expect(released).toEqual([undefined]);
  });

  it("rolls back, releases the connection and rethrows a cancellation", async () => {
    const cancelled = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
    const { pool, statements, released } = fakePool(cancelled);
    await expect(queryWithStatementTimeout(pool, 700, "SELECT 1", [])).rejects.toBe(cancelled);
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(released).toEqual([undefined]);
  });
});

describe("in-memory municipality index", () => {
  function cityQueryable(cities: string[]) {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    return {
      calls,
      queryable: {
        async query(text: string, values: unknown[] = []) {
          calls.push({ text, values });
          if (text.includes("WITH RECURSIVE cities")) {
            return { rows: cities.map((search_city) => ({ search_city })) };
          }
          return { rows: [{ search_city: "fallback" }] };
        },
      },
    };
  }

  it("loads the municipalities once per dataset and prefers the longest suffix", async () => {
    const { queryable, calls } = cityQueryable(["kamenice", "ceska kamenice", "praha"]);
    const index = createCitySuffixIndex(queryable);
    const [first, second] = await Promise.all([
      index.resolve("v1", ["3 ceska kamenice", "ceska kamenice", "kamenice"]),
      index.resolve("v1", ["dolni kamenice", "kamenice"]),
    ]);
    expect(first).toBe("ceska kamenice");
    expect(second).toBe("kamenice");
    expect(await index.resolve("v1", ["brno"])).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual(["v1"]);
    await index.resolve("v2", ["praha"]);
    expect(calls).toHaveLength(2);
    expect(index.datasetId).toBe("v2");
  });

  it("falls back to the per-request query while the list cannot be loaded", async () => {
    let now = 0;
    let failing = true;
    const calls: string[] = [];
    const index = createCitySuffixIndex(
      {
        async query(text: string) {
          calls.push(text.includes("WITH RECURSIVE") ? "load" : "group-by");
          if (text.includes("WITH RECURSIVE")) {
            if (failing) throw new Error("timeout");
            return { rows: [{ search_city: "praha" }] };
          }
          return { rows: [{ search_city: "praha" }] };
        },
      },
      () => now,
    );
    expect(await index.resolve("v1", ["praha"])).toBe("praha");
    expect(await index.resolve("v1", ["praha"])).toBe("praha");
    expect(calls).toEqual(["load", "group-by", "group-by"]);
    failing = false;
    now = 60_001;
    expect(await index.resolve("v1", ["praha"])).toBe("praha");
    expect(await index.resolve("v1", ["praha"])).toBe("praha");
    expect(calls).toEqual(["load", "group-by", "group-by", "load"]);
  });
});

describe("municipality without streets (RÚIAN rows in memory)", () => {
  type Row = {
    id: string;
    municipality: string;
    municipality_part: string | null;
    street: string | null;
    house_number_type: string;
    house_number: string;
    orientation_number: string | null;
    postal_code: string;
  };
  const row = (
    id: string,
    municipality: string,
    part: string | null,
    street: string | null,
    houseNumber: string,
    postalCode: string,
    type = "1",
  ): Row => ({
    id,
    municipality,
    municipality_part: part,
    street,
    house_number_type: type,
    house_number: houseNumber,
    orientation_number: null,
    postal_code: postalCode,
  });
  const table: Row[] = [
    row("sudomerice-242", "Sudoměřice", "Sudoměřice", null, "242", "69666"),
    row("sudomerice-241", "Sudoměřice", "Sudoměřice", null, "241", "69666"),
    row("adrspach-13", "Adršpach", "Dolní Adršpach", null, "13", "54952"),
    row("dvojice-horni-5", "Dvojice", "Horní Dvojice", null, "5", "33301"),
    row("dvojice-dolni-5", "Dvojice", "Dolní Dvojice", null, "5", "33301"),
    row("smisena-hlavni-3", "Smíšená", "Smíšená", "Hlavní", "3", "55501"),
    row("smisena-lhota-3", "Smíšená", "Lhota", null, "3", "55501"),
    row("chatova-ev-9", "Chatová", "Chatová", null, "9", "66601", "2"),
  ];
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const queries: string[] = [];
  const queryable = {
    async query(text: string, values: unknown[] = []) {
      queries.push(text);
      if (!text.includes("house_number_type = $3")) return { rows: [] };
      const [city, houseNumber, type] = values as [string, string, string | null];
      return {
        rows: table
          .filter(
            (candidate) =>
              normalize(candidate.municipality) === city &&
              candidate.house_number === houseNumber &&
              (type === null || candidate.house_number_type === type),
          )
          .map((candidate) => ({
            ...candidate,
            dataset_version_id: "dataset-a",
            address_line: `${candidate.street ?? candidate.municipality_part} ${candidate.house_number}, ${candidate.postal_code} ${candidate.municipality}`,
          })),
      };
    },
  };
  const search = (street_line: string, city: string, postal_code: string) =>
    searchCzechAddresses(queryable, [street_line, city, postal_code].filter(Boolean).join(" "), {
      components: { street_line, city, postal_code },
    });

  it("returns Sudoměřice 242 for a bare 242 in Sudoměřice", async () => {
    const result = await search("242", "Sudoměřice", "696 66");
    expect(result.advice).toEqual({
      code: "address.village_street",
      street_line: "Sudoměřice 242",
    });
    expect(result.status).toBe("matched");
    expect(result.suggestions.map((s) => [s.id, s.houseNumberType])).toEqual([
      ["sudomerice-242", "1"],
    ]);
    expect(result.evidence.datasetVersionId).toBe("dataset-a");
  });

  it("keeps a slash or a letter and drops a typed č. p.", async () => {
    expect((await search("242/3", "Sudoměřice", "69666")).advice).toMatchObject({
      street_line: "Sudoměřice 242/3",
    });
    expect((await search("242a", "Sudoměřice", "69666")).advice).toMatchObject({
      street_line: "Sudoměřice 242a",
    });
    expect((await search("č. p. 242", "Sudoměřice", "")).advice).toMatchObject({
      street_line: "Sudoměřice 242",
    });
  });

  it("uses the part name and writes č. ev.", async () => {
    expect((await search("13", "Adršpach", "")).advice).toMatchObject({
      street_line: "Dolní Adršpach 13",
    });
    expect((await search("9", "Chatová", "")).advice).toMatchObject({
      street_line: "Chatová č. ev. 9",
    });
    expect((await search("č.p. 9", "Chatová", "")).advice?.code).not.toBe("address.village_street");
  });

  it("gives no village advice when the number is ambiguous or on a street", async () => {
    expect((await search("5", "Dvojice", "33301")).advice?.code).not.toBe("address.village_street");
    expect((await search("3", "Smíšená", "55501")).advice?.code).not.toBe("address.village_street");
    expect((await search("999", "Sudoměřice", "")).advice?.code).not.toBe("address.village_street");
  });

  it("reports a different PSČ instead of completing the street", async () => {
    const result = await search("242", "Sudoměřice", "69667");
    expect(result.advice).toEqual({ code: "address.postal_code_mismatch", postal_code: "69666" });
  });

  it("does not look up villages for a street name or without a city", async () => {
    queries.length = 0;
    await search("Hlavní 3", "Smíšená", "55501");
    await search("242", "", "69666");
    expect(queries.some((text) => text.includes("house_number_type = $3"))).toBe(false);
  });
});

function candidate(
  overrides: Partial<{
    id: string;
    house_number: string;
    orientation_number: string | null;
    address_line: string;
    search_full: string;
    trigram_similarity: number;
  }> = {},
) {
  return {
    id: "candidate-1",
    municipality: "Praha",
    municipality_part: "Praha 2",
    street: "Karlovo náměstí",
    house_number: "19",
    orientation_number: "13",
    postal_code: "12000",
    address_line: "Karlovo náměstí 19/13, Nové Město, 120 00 Praha 2",
    search_full: "karlovo namesti 19 13 nove mesto praha 12000",
    search_postal_code: "12000",
    trigram_similarity: 0.5,
    source_version: "2026-08-01",
    effective_at: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}
