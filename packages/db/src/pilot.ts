import { Pool } from "pg";
import { interactivePoolOptions } from "./interactive-pool.js";

export interface PilotApiKeyRecord {
  readonly id: string;
  readonly projectRef: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly verifier: string;
  readonly state: "active" | "revoked";
  readonly integrationId?: string | null;
  readonly environment?: "test" | "live";
}

export interface CreatePilotApiKeyInput extends PilotApiKeyRecord {
  readonly createdAt: Date;
}

export interface UsageEventInput {
  readonly id: string;
  readonly requestId: string;
  readonly projectRef: string;
  readonly apiKeyId: string;
  readonly operation: string;
  readonly idempotencyKeyHash: string;
  readonly integrationMode: "api" | "shadow";
  readonly clientName: string | null;
  readonly durationMs: number;
  readonly units: number;
  readonly resultClass: string;
  readonly createdAt: Date;
}

export interface PilotStore {
  findApiKeyByPrefix(prefix: string): Promise<PilotApiKeyRecord | null>;
  createApiKey(input: CreatePilotApiKeyInput): Promise<void>;
  recordUsage(input: UsageEventInput): Promise<boolean>;
  close(): Promise<void>;
}

interface ApiKeyRow {
  id: string;
  project_ref: string;
  name: string;
  key_prefix: string;
  verifier: string;
  state: "active" | "revoked";
  integration_id: string | null;
  environment: "test" | "live";
}

export function createPostgresPilotStore(connectionString: string): PilotStore {
  const pool = new Pool({ ...interactivePoolOptions, connectionString });

  return {
    async findApiKeyByPrefix(prefix) {
      const result = await pool.query<ApiKeyRow>(
        `SELECT id, project_ref, name, key_prefix, verifier, state, integration_id, environment
         FROM app.api_keys
         WHERE key_prefix = $1
         LIMIT 1`,
        [prefix],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            projectRef: row.project_ref,
            name: row.name,
            keyPrefix: row.key_prefix,
            verifier: row.verifier,
            state: row.state,
            integrationId: row.integration_id,
            environment: row.environment,
          }
        : null;
    },

    async createApiKey(input) {
      await pool.query(
        `INSERT INTO app.api_keys (
           id, project_ref, name, key_prefix, verifier, state, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          input.projectRef,
          input.name,
          input.keyPrefix,
          input.verifier,
          input.state,
          input.createdAt,
        ],
      );
    },

    async recordUsage(input) {
      // One statement: one round trip and an implicit transaction. A repeated idempotency key
      // inserts nothing and touches nothing. The API key row shared by all shoppers of a shop is
      // written at most once a minute (so last_used_at may lag by up to a minute) instead of being
      // locked by every request, and an older event never moves last_used_at back.
      const result = await pool.query<{ id: string }>(
        `WITH inserted AS (
           INSERT INTO app.usage_events (
             id, request_id, project_ref, api_key_id, operation,
             idempotency_key_hash, integration_mode, client_name, duration_ms,
             units, result_class, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (api_key_id, operation, idempotency_key_hash) DO NOTHING
           RETURNING id, api_key_id
         ), touched AS (
           UPDATE app.api_keys AS api_key
           SET last_used_at = $12
           FROM inserted
           WHERE api_key.id = inserted.api_key_id
             AND (
               api_key.last_used_at IS NULL
               OR api_key.last_used_at < $12::timestamptz - interval '1 minute'
             )
         )
         SELECT id FROM inserted`,
        [
          input.id,
          input.requestId,
          input.projectRef,
          input.apiKeyId,
          input.operation,
          input.idempotencyKeyHash,
          input.integrationMode,
          input.clientName,
          input.durationMs,
          input.units,
          input.resultClass,
          input.createdAt,
        ],
      );
      return result.rows.length === 1;
    },

    async close() {
      await pool.end();
    },
  };
}
