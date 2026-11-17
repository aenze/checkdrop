import { Pool } from "pg";

const connectionString = process.env.CHECKDROP_DATABASE_URL;
if (!connectionString) {
  throw new Error("CHECKDROP_DATABASE_URL is required for shadow observation cleanup.");
}

const pool = new Pool({ connectionString, max: 1 });

try {
  const result = await pool.query("DELETE FROM app.shadow_observations WHERE expires_at <= now()");
  await pool.query("DELETE FROM app.checkout_events WHERE created_at < now() - interval '90 days'");
  process.stdout.write(
    `${JSON.stringify({ event: "shadow_observations.cleanup.complete", deleted: result.rowCount ?? 0 })}\n`,
  );
} finally {
  await pool.end();
}
