import { readFileSync } from "node:fs";
import { normalizeCzechAddressSearch } from "@checkdrop/pack-cz";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AddressSearcher,
  addressSearchPoolOptions,
  createCitySuffixIndex,
  createPostgresAddressSearcher,
  queryWithStatementTimeout,
} from "../src/address-search.js";

const connection = process.env.CHECKDROP_ADDRESS_TEST_DATABASE_URL;
describe.skipIf(!connection)("cached RÚIAN search on isolated PostgreSQL", () => {
  let pool: Pool;
  let searcher: AddressSearcher;
  let clock = 0;
  beforeAll(async () => {
    if (!connection) throw new Error("Test database URL required");
    const url = new URL(connection);
    if (url.pathname !== "/checkdrop_address_qa" || url.hostname !== "127.0.0.1") {
      throw new Error("Only a local, disposable checkdrop_address_qa database is allowed");
    }
    pool = new Pool({ connectionString: connection });
    // Intentionally fails if the schema already exists. Never clean or overwrite a database.
    await pool.query("CREATE SCHEMA reference_cz");
    for (const migration of [
      "0001_reference_foundation.sql",
      "0002_ruian_staging.sql",
      "0003_address_city_exact.sql",
      "0009_ruian_snapshot_rotation.sql",
    ]) {
      await pool.query(
        readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"),
      );
    }
    await pool.query(`
      INSERT INTO reference_cz.dataset_versions (id, source, version, effective_at, row_count, checksum, state)
      VALUES
        ('dataset-a', 'ruian-st-uads', '2026-08-03', '2026-08-03', 1, 'a', 'active'),
        ('dataset-b', 'ruian-st-uads', '2026-09-03', '2026-09-03', 1, 'b', 'staged')`);
    for (const [dataset, municipality] of [
      ["dataset-a", "Lhota"],
      ["dataset-b", "Lhota u Kladna"],
    ] as const) {
      const structured = `Sokolská 134 ${municipality} 27201`;
      await pool.query(
        `INSERT INTO reference_cz.addresses (
           id, dataset_version_id, municipality, municipality_part, street, house_number_type,
           house_number, orientation_number, postal_code, address_line,
           search_full, search_city, search_street, search_postal_code
         ) VALUES ('1', $1, $2, NULL, 'Sokolská', '', '134', NULL, '27201', $3, $4, $5, $6, '27201')`,
        [
          dataset,
          municipality,
          `Sokolská 134, 272 01 ${municipality}`,
          normalizeCzechAddressSearch(structured),
          normalizeCzechAddressSearch(municipality),
          normalizeCzechAddressSearch("Sokolská 134"),
        ],
      );
    }
    searcher = createPostgresAddressSearcher(connection, { cache: { now: () => clock } });
  });
  afterAll(async () => {
    await searcher?.close();
    await pool?.end();
  });

  it("loads the municipalities of one dataset for the in-memory city index", async () => {
    const index = createCitySuffixIndex(pool);
    expect(await index.resolve("dataset-a", ["sokolska lhota", "lhota"])).toBe("lhota");
    expect(await index.resolve("dataset-b", ["u kladna", "lhota u kladna"])).toBe("lhota u kladna");
    expect(await index.resolve("dataset-b", ["lhota"])).toBeNull();
  });

  it("serves the new dataset at the first miss after a rotation and to all within a minute", async () => {
    const before = await searcher.search("Sokolská 134 27201");
    expect(before.evidence.datasetVersionId).toBe("dataset-a");
    expect(before.suggestions[0]?.municipality).toBe("Lhota");
    const cachedCopy = await searcher.search("Sokolská 134 27201");
    expect(cachedCopy.suggestions).toEqual(before.suggestions);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE reference_cz.dataset_versions SET state = 'archived' WHERE id = 'dataset-a'",
      );
      await client.query(
        "UPDATE reference_cz.dataset_versions SET state = 'active' WHERE id = 'dataset-b'",
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    // A hit within the minute in which the active dataset ID is trusted may be the old dataset.
    clock = 30_000;
    const hit = await searcher.search("Sokolská 134 27201");
    expect(hit.evidence.datasetVersionId).toBe("dataset-a");
    // The first miss sees the new dataset in its own result and rotates the cache.
    const miss = await searcher.search("Sokolská 134, 272 01");
    expect(miss.evidence.datasetVersionId).toBe("dataset-b");
    const after = await searcher.search("Sokolská 134 27201");
    expect(after.evidence.datasetVersionId).toBe("dataset-b");
    expect(after.suggestions[0]?.municipality).toBe("Lhota u Kladna");
  });

  it("cancels an address query that runs longer than the statement timeout", async () => {
    if (!connection) throw new Error("Test database URL required");
    const limited = new Pool(addressSearchPoolOptions(connection, 200));
    try {
      const started = performance.now();
      await expect(limited.query("SELECT pg_sleep(2)")).rejects.toMatchObject({ code: "57014" });
      expect(performance.now() - started).toBeLessThan(1_500);
    } finally {
      await limited.end();
    }
    expect(addressSearchPoolOptions(connection).statement_timeout).toBe(2_000);
  });

  it("cancels only the limited fallback and leaves the connection's own limit intact", async () => {
    if (!connection) throw new Error("Test database URL required");
    const limited = new Pool({ ...addressSearchPoolOptions(connection), max: 1 });
    try {
      const started = performance.now();
      await expect(
        queryWithStatementTimeout(limited, 150, "SELECT pg_sleep(2)", []),
      ).rejects.toMatchObject({ code: "57014" });
      expect(performance.now() - started).toBeLessThan(1_000);
      const setting = await limited.query<{ statement_timeout: string }>("SHOW statement_timeout");
      expect(setting.rows[0]?.statement_timeout).toBe("2s");
      const ok = await queryWithStatementTimeout<{ one: number }>(
        limited,
        150,
        "SELECT 1 AS one",
        [],
      );
      expect(ok.rows).toEqual([{ one: 1 }]);
    } finally {
      await limited.end();
    }
  });

  it("answers a typo through the limited whole-address fallback", async () => {
    const typo = await searcher.search("Sokolsk 134");
    expect(typo.suggestions[0]?.street).toBe("Sokolská");
  });

  it("keeps reporting no match truthfully", async () => {
    const missing = await searcher.search("Neexistující 9999 99999");
    expect(missing.status).toBe("unknown");
    expect(missing.suggestions).toEqual([]);
  });
});
