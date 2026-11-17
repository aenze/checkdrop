CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.api_keys (
  id text PRIMARY KEY,
  project_ref text NOT NULL,
  name text NOT NULL,
  key_prefix text NOT NULL UNIQUE,
  verifier text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS app.usage_events (
  id text PRIMARY KEY,
  request_id text NOT NULL,
  project_ref text NOT NULL,
  api_key_id text NOT NULL REFERENCES app.api_keys(id),
  operation text NOT NULL,
  idempotency_key_hash text NOT NULL,
  units integer NOT NULL DEFAULT 1 CHECK (units > 0),
  result_class text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (api_key_id, operation, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS usage_events_created_at_idx
  ON app.usage_events (created_at DESC);

CREATE INDEX IF NOT EXISTS usage_events_project_operation_idx
  ON app.usage_events (project_ref, operation, created_at DESC);
