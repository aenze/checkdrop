import { readdirSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Applies every migration to a disposable database, the same way migrate.ts does in production.
const connection = process.env.CHECKDROP_MIGRATIONS_TEST_DATABASE_URL;
const migrationsUrl = new URL("../migrations/", import.meta.url);

describe.skipIf(!connection)("integration field uniqueness on isolated PostgreSQL", () => {
  let pool: Pool;
  beforeAll(async () => {
    if (!connection) throw new Error("Test database URL required");
    const url = new URL(connection);
    if (url.pathname !== "/checkdrop_migrations_qa" || url.hostname !== "127.0.0.1") {
      throw new Error("Only a local, disposable checkdrop_migrations_qa database is allowed");
    }
    pool = new Pool({ connectionString: connection });
    // Intentionally fails if a schema already exists. Never clean or overwrite a database.
    await pool.query("CREATE SCHEMA app");
    const files = readdirSync(migrationsUrl)
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const name of files) await pool.query(readFileSync(new URL(name, migrationsUrl), "utf8"));
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("keeps selector uniqueness per form only, so two forms of one site may share a selector", async () => {
    const legacy = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'app.integration_fields'::regclass AND contype = 'u'
    `);
    expect(legacy.rows).toEqual([]);
    const index = await pool.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'app' AND indexname = 'integration_fields_form_selector_context_idx'
    `);
    expect(index.rows[0]?.indexdef).toContain("UNIQUE");
    expect(index.rows[0]?.indexdef).toContain("(form_id, source_selector, field_context)");
  });
});
