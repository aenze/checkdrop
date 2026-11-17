import { Pool } from "pg";
import { interactivePoolOptions } from "./interactive-pool.js";

export interface InstanceJobState {
  readonly name: string;
  readonly state: "running" | "succeeded" | "failed";
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly message: string | null;
}

export interface AddressDataStatus {
  readonly version: string;
  readonly effectiveAt: string;
  readonly rowCount: number;
}

/** What an administrator needs to see about the installation itself, without customer data. */
export interface InstanceStatusStore {
  activeAddressData(): Promise<AddressDataStatus | null>;
  jobs(): Promise<readonly InstanceJobState[]>;
  jobStarted(name: string, at: Date): Promise<void>;
  jobFinished(name: string, at: Date, ok: boolean, message: string | null): Promise<void>;
  close(): Promise<void>;
}

export function createInstanceStatusStore(connectionString: string): InstanceStatusStore {
  const pool = new Pool({ ...interactivePoolOptions, connectionString, max: 2 });
  return {
    async activeAddressData() {
      const result = await pool.query<{ version: string; effective_at: Date; row_count: number }>(
        `SELECT version, effective_at, row_count FROM reference_cz.dataset_versions
         WHERE source = 'ruian-st-uads' AND state = 'active'
         ORDER BY effective_at DESC LIMIT 1`,
      );
      const row = result.rows[0];
      return row
        ? {
            version: row.version,
            effectiveAt: row.effective_at.toISOString(),
            rowCount: row.row_count,
          }
        : null;
    },
    async jobs() {
      const result = await pool.query<{
        name: string;
        state: InstanceJobState["state"];
        started_at: Date;
        finished_at: Date | null;
        message: string | null;
      }>(
        "SELECT name, state, started_at, finished_at, message FROM app.instance_jobs ORDER BY name",
      );
      return result.rows.map((row) => ({
        name: row.name,
        state: row.state,
        startedAt: row.started_at.toISOString(),
        finishedAt: row.finished_at?.toISOString() ?? null,
        message: row.message,
      }));
    },
    async jobStarted(name, at) {
      await pool.query(
        `INSERT INTO app.instance_jobs (name, state, started_at, finished_at, message)
         VALUES ($1, 'running', $2, NULL, NULL)
         ON CONFLICT (name) DO UPDATE SET state = 'running', started_at = $2, finished_at = NULL, message = NULL`,
        [name, at],
      );
    },
    async jobFinished(name, at, ok, message) {
      await pool.query(
        `UPDATE app.instance_jobs SET state = $2, finished_at = $3, message = $4 WHERE name = $1`,
        [name, ok ? "succeeded" : "failed", at, message?.slice(0, 500) ?? null],
      );
    },
    async close() {
      await pool.end();
    },
  };
}
