import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const connectionString = process.env.CHECKDROP_DATABASE_URL;
if (!connectionString) {
  throw new Error("CHECKDROP_DATABASE_URL is required for migrations.");
}

const migrationsUrl = new URL("../migrations/", import.meta.url);
const migrationDirectory = fileURLToPath(migrationsUrl);
const pool = new Pool({ connectionString });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.checkdrop_schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const name of migrationFiles) {
    const alreadyApplied = await pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM public.checkdrop_schema_migrations WHERE name = $1) AS exists",
      [name],
    );

    if (alreadyApplied.rows[0]?.exists) {
      process.stdout.write(`Skipped ${name} (already applied)\n`);
      continue;
    }

    const sql = await readFile(new URL(name, migrationsUrl), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO public.checkdrop_schema_migrations (name) VALUES ($1)", [
        name,
      ]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
