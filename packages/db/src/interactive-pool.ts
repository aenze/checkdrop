import type { PoolConfig } from "pg";

/** Generous upper bounds for interactive requests; import/maintenance pools stay separate. */
export const interactivePoolOptions: PoolConfig = {
  connectionTimeoutMillis: 2_000,
  statement_timeout: 10_000,
  lock_timeout: 1_000,
  idle_in_transaction_session_timeout: 15_000,
};
