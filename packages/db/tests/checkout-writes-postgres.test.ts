import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPostgresPilotStore, type PilotStore, type UsageEventInput } from "../src/pilot.js";
import { importRuianAddresses, pruneArchivedRuianDatasets } from "../src/ruian.js";
import {
  createPostgresShadowObservationStore,
  type SaveShadowObservationInput,
  type ShadowObservationStore,
} from "../src/shadow-observation.js";

// Applies every migration to a disposable database, the same way migrate.ts does in production.
const connection = process.env.CHECKDROP_WRITES_TEST_DATABASE_URL;
const migrationsUrl = new URL("../migrations/", import.meta.url);
const apiKeyId = "key-writes";
const createdAt = new Date("2026-11-12T10:00:00.000Z");
const at = (seconds: number) => new Date(createdAt.getTime() + seconds * 1_000);
const hash = (n: number) => n.toString(16).padStart(64, "0");
let sequence = 0;

function usage(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  sequence += 1;
  return {
    id: `usage-${sequence}`,
    requestId: `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    projectRef: "project-writes",
    apiKeyId,
    operation: "address.autocomplete",
    idempotencyKeyHash: hash(sequence),
    integrationMode: "api",
    clientName: "shop-test",
    durationMs: 12,
    units: 1,
    resultClass: "matched",
    createdAt,
    ...overrides,
  };
}

describe.skipIf(!connection)("checkout write path on isolated PostgreSQL", () => {
  let pool: Pool;
  let pilot: PilotStore;
  let observations: ShadowObservationStore;
  const lastUsedAt = async () =>
    (
      await pool.query<{ last_used_at: Date | null }>(
        "SELECT last_used_at FROM app.api_keys WHERE id = $1",
        [apiKeyId],
      )
    ).rows[0]?.last_used_at ?? null;

  beforeAll(async () => {
    if (!connection) throw new Error("Test database URL required");
    const url = new URL(connection);
    if (url.pathname !== "/checkdrop_writes_qa" || url.hostname !== "127.0.0.1") {
      throw new Error("Only a local, disposable checkdrop_writes_qa database is allowed");
    }
    pool = new Pool({ connectionString: connection });
    // Intentionally fails if a schema already exists. Never clean or overwrite a database.
    await pool.query("CREATE SCHEMA app");
    const files = readdirSync(migrationsUrl)
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const name of files) await pool.query(readFileSync(new URL(name, migrationsUrl), "utf8"));
    pilot = createPostgresPilotStore(connection);
    observations = createPostgresShadowObservationStore(connection);
    await pilot.createApiKey({
      id: apiKeyId,
      projectRef: "project-writes",
      name: "Writes",
      keyPrefix: "cdp_0123456789ab",
      verifier: `sha256:${"a".repeat(64)}`,
      state: "active",
      createdAt,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await pilot?.close();
    await observations?.close();
    await pool?.end();
  });

  it("records usage in one statement and keeps idempotent duplicates out", async () => {
    const queries = vi.spyOn(Client.prototype, "query");
    const first = usage();
    expect(await pilot.recordUsage(first)).toBe(true);
    expect(queries).toHaveBeenCalledTimes(1);
    expect(String(queries.mock.calls[0]?.[0])).not.toMatch(/^\s*BEGIN/);
    queries.mockRestore();

    expect(await lastUsedAt()).toEqual(createdAt);
    // The same idempotency key, even with a new event ID and later time, records nothing.
    const duplicate = usage({ idempotencyKeyHash: first.idempotencyKeyHash, createdAt: at(300) });
    expect(await pilot.recordUsage(duplicate)).toBe(false);
    expect(await lastUsedAt()).toEqual(createdAt);
    const stored = await pool.query(
      "SELECT id FROM app.usage_events WHERE idempotency_key_hash = $1",
      [first.idempotencyKeyHash],
    );
    expect(stored.rows).toEqual([{ id: first.id }]);
    // The key is unique per operation, as before.
    expect(
      await pilot.recordUsage(
        usage({ idempotencyKeyHash: first.idempotencyKeyHash, operation: "email.validate" }),
      ),
    ).toBe(true);
  });

  it("refreshes last_used_at at most once a minute and never moves it back", async () => {
    await pool.query("UPDATE app.api_keys SET last_used_at = $2 WHERE id = $1", [
      apiKeyId,
      at(1_000),
    ]);
    expect(await pilot.recordUsage(usage({ createdAt: at(1_030) }))).toBe(true);
    expect(await lastUsedAt()).toEqual(at(1_000));
    expect(await pilot.recordUsage(usage({ createdAt: at(1_060) }))).toBe(true);
    expect(await lastUsedAt()).toEqual(at(1_000));
    expect(await pilot.recordUsage(usage({ createdAt: at(1_061) }))).toBe(true);
    expect(await lastUsedAt()).toEqual(at(1_061));
    expect(await pilot.recordUsage(usage({ createdAt: at(10) }))).toBe(true);
    expect(await lastUsedAt()).toEqual(at(1_061));
  });

  it("does not wait for another request holding the shared API key row", async () => {
    await pool.query("UPDATE app.api_keys SET last_used_at = $2 WHERE id = $1", [
      apiKeyId,
      at(2_000),
    ]);
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      // Another request updating the key row; the old code then waited for lock_timeout (503).
      await holder.query("UPDATE app.api_keys SET last_used_at = $2 WHERE id = $1", [
        apiKeyId,
        at(2_001),
      ]);
      const started = performance.now();
      expect(await pilot.recordUsage(usage({ createdAt: at(2_010) }))).toBe(true);
      expect(performance.now() - started).toBeLessThan(500);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });

  it("saves an observation in one statement with the same duplicate semantics", async () => {
    const input: SaveShadowObservationInput = {
      id: "observation-1",
      requestId: "00000000-0000-4000-8000-100000000001",
      projectRef: "project-writes",
      apiKeyId,
      operation: "email.validate",
      idempotencyKeyHash: hash(9_001),
      clientName: "shop-test",
      formId: null,
      checkoutSessionRef: null,
      inputValue: "jan@example.cz",
      proposedValue: null,
      inputPreview: "j***@example.cz",
      proposedPreview: null,
      changed: false,
      resultClass: "valid",
      action: "accept",
      issueCodes: [],
      evidenceSources: ["syntax"],
      durationMs: 3,
      createdAt,
      expiresAt: at(3_600),
    };
    const queries = vi.spyOn(Client.prototype, "query");
    expect(await observations.save(input)).toBe(true);
    expect(queries).toHaveBeenCalledTimes(1);
    queries.mockRestore();
    expect(await observations.save({ ...input, id: "observation-2" })).toBe(false);
    const stored = await pool.query("SELECT id FROM app.shadow_observations");
    expect(stored.rows).toEqual([{ id: "observation-1" }]);
    // A conflicting primary key is still an error, not a silent duplicate.
    await expect(
      observations.save({ ...input, idempotencyKeyHash: hash(9_002) }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("refreshes planner statistics after a RÚIAN import and after pruning", async () => {
    if (!connection) throw new Error("Test database URL required");
    const analyzeCount = async () =>
      Number(
        (
          await pool.query<{ analyze_count: string }>(
            `SELECT analyze_count FROM pg_stat_user_tables
              WHERE schemaname = 'reference_cz' AND relname = 'addresses'`,
          )
        ).rows[0]?.analyze_count ?? 0,
      );
    const beforeImport = await analyzeCount();
    const imported = await importRuianAddresses({
      connectionString: connection,
      input: createReadStream(
        new URL("../../../fixtures/ruian/sample-addresses.xml", import.meta.url),
      ),
    });
    expect(imported).toMatchObject({ state: "active", rowCount: 3, statisticsRefreshed: true });
    expect(await analyzeCount()).toBe(beforeImport + 1);

    await pool.query(`
      INSERT INTO reference_cz.dataset_versions
        (id, source, version, effective_at, row_count, checksum, state, archived_at)
      VALUES ('old', 'ruian-st-uads', '2020-01-01', '2020-01-01', 1, 'old', 'archived', '2020-02-01')`);
    await pool.query(`
      INSERT INTO reference_cz.addresses (
        id, dataset_version_id, municipality, street, house_number, postal_code,
        search_full, search_city, search_street
      ) VALUES ('1', 'old', 'Ves', NULL, '1', '11111', '1 ves 11111', 'ves', 'ves 1')`);
    const pruned = await pruneArchivedRuianDatasets(connection, new Date("2021-01-01"));
    expect(pruned).toEqual({ datasets: 1, addresses: 1, statisticsRefreshed: true });
    expect(await analyzeCount()).toBe(beforeImport + 2);
    // Nothing to prune means nothing to analyze.
    expect(await pruneArchivedRuianDatasets(connection, new Date("2021-01-01"))).toEqual({
      datasets: 0,
      addresses: 0,
    });
  });
});
