import { Pool } from "pg";
import { createShadowObservationCipher } from "./shadow-observation-crypto.js";
import { createShadowObservationSearchIndex } from "./shadow-observation-search.js";

const connectionString = process.env.CHECKDROP_DATABASE_URL;
const encryptionKey = process.env.CHECKDROP_OBSERVATION_ENCRYPTION_KEY;
if (!connectionString) throw new Error("CHECKDROP_DATABASE_URL is required.");
if (!encryptionKey) throw new Error("CHECKDROP_OBSERVATION_ENCRYPTION_KEY is required.");

const cipher = createShadowObservationCipher(encryptionKey);
const searchIndex = createShadowObservationSearchIndex(encryptionKey);
if (!cipher || !searchIndex) throw new Error("Shadow search encryption is not configured.");

const pool = new Pool({ connectionString, max: 2 });
let indexed = 0;
let unavailable = 0;

try {
  for (;;) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const batch = await client.query<{
        id: string;
        input_value_ciphertext: string | null;
      }>(
        `SELECT id, input_value_ciphertext
         FROM app.shadow_observations
         WHERE search_index_version = 0
           AND expires_at > now()
         ORDER BY created_at, id
         LIMIT 250
         FOR UPDATE SKIP LOCKED`,
      );
      if (batch.rows.length === 0) {
        await client.query("COMMIT");
        break;
      }
      const updates = batch.rows.map((row) => {
        let tokens: readonly string[] = [];
        if (row.input_value_ciphertext) {
          try {
            const value = cipher.decrypt(row.input_value_ciphertext, `${row.id}:input`);
            tokens = searchIndex.valueTokens(value);
          } catch {
            unavailable += 1;
          }
        }
        return { id: row.id, tokens };
      });
      const values: unknown[] = [];
      const tuples = updates.map((update) => {
        values.push(update.id, update.tokens);
        return `($${values.length - 1}::text, $${values.length}::text[])`;
      });
      await client.query(
        `UPDATE app.shadow_observations AS observation
         SET search_tokens = update_value.tokens,
             search_index_version = 1
         FROM (VALUES ${tuples.join(", ")}) AS update_value(id, tokens)
         WHERE observation.id = update_value.id`,
        values,
      );
      await client.query("COMMIT");
      indexed += updates.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  process.stdout.write(`Shadow search index ready: ${indexed} rows, ${unavailable} unavailable.\n`);
} finally {
  await pool.end();
}
