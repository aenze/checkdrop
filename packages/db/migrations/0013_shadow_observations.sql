CREATE TABLE IF NOT EXISTS app.shadow_observations (
  id text PRIMARY KEY,
  request_id text NOT NULL,
  project_ref text NOT NULL,
  api_key_id text NOT NULL REFERENCES app.api_keys(id),
  operation text NOT NULL CHECK (operation IN ('email.validate', 'phone.validate')),
  idempotency_key_hash text NOT NULL,
  client_name text NOT NULL,
  input_preview text NOT NULL,
  proposed_preview text,
  changed boolean NOT NULL,
  result_class text NOT NULL CHECK (
    result_class IN ('valid', 'correctable', 'risky', 'invalid', 'unknown')
  ),
  action text NOT NULL CHECK (
    action IN ('accept', 'normalize', 'suggest', 'warn', 'block', 'defer', 'fail_open')
  ),
  issue_codes text[] NOT NULL DEFAULT '{}',
  evidence_sources text[] NOT NULL DEFAULT '{}',
  duration_ms integer NOT NULL CHECK (duration_ms >= 0 AND duration_ms <= 300000),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (api_key_id, operation, idempotency_key_hash),
  CHECK (request_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  CHECK (client_name ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' AND client_name ~ '[A-Za-z]'),
  CHECK (char_length(input_preview) BETWEEN 1 AND 160),
  CHECK (proposed_preview IS NULL OR char_length(proposed_preview) BETWEEN 1 AND 160),
  CHECK (cardinality(issue_codes) <= 32),
  CHECK (cardinality(evidence_sources) <= 16),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '25 hours')
);

CREATE INDEX IF NOT EXISTS shadow_observations_project_created_idx
  ON app.shadow_observations (project_ref, created_at DESC);

CREATE INDEX IF NOT EXISTS shadow_observations_expiry_idx
  ON app.shadow_observations (expires_at);
