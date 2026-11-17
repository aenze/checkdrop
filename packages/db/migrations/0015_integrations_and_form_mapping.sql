CREATE TABLE IF NOT EXISTS app.integrations (
  id text PRIMARY KEY,
  project_ref text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  client_name text NOT NULL CHECK (
    char_length(client_name) BETWEEN 1 AND 64
    AND client_name ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
  ),
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'live')),
  form_url text NOT NULL CHECK (char_length(form_url) BETWEEN 8 AND 2048),
  state text NOT NULL DEFAULT 'draft' CHECK (
    state IN ('draft', 'scanned', 'configured', 'shadow', 'paused')
  ),
  config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_ref, client_name)
);

CREATE INDEX IF NOT EXISTS integrations_project_updated_idx
  ON app.integrations (project_ref, updated_at DESC);

CREATE TABLE IF NOT EXISTS app.form_scans (
  id text PRIMARY KEY,
  integration_id text NOT NULL REFERENCES app.integrations(id) ON DELETE CASCADE,
  sanitized_url text NOT NULL CHECK (char_length(sanitized_url) BETWEEN 8 AND 2048),
  state text NOT NULL CHECK (state IN ('completed', 'failed')),
  detected_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(detected_fields) = 'array'),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_scans_integration_created_idx
  ON app.form_scans (integration_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.integration_fields (
  id text PRIMARY KEY,
  integration_id text NOT NULL REFERENCES app.integrations(id) ON DELETE CASCADE,
  source_selector text NOT NULL CHECK (char_length(source_selector) BETWEEN 1 AND 512),
  source_label text NOT NULL DEFAULT '' CHECK (char_length(source_label) <= 240),
  source_name text CHECK (source_name IS NULL OR char_length(source_name) <= 240),
  canonical_field text NOT NULL CHECK (canonical_field IN (
    'customer_type', 'full_name', 'email', 'phone', 'street_line',
    'city', 'postal_code', 'country', 'company_id', 'unmapped'
  )),
  field_context text NOT NULL DEFAULT 'billing' CHECK (
    field_context IN ('billing', 'shipping', 'company', 'shared')
  ),
  condition_key text CHECK (condition_key IS NULL OR char_length(condition_key) <= 120),
  required boolean NOT NULL DEFAULT false,
  validation_mode text NOT NULL DEFAULT 'shadow' CHECK (
    validation_mode IN ('off', 'shadow', 'suggest', 'normalize')
  ),
  validation_trigger text NOT NULL DEFAULT 'blur' CHECK (
    validation_trigger IN ('input', 'blur', 'submit')
  ),
  confidence integer CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  detected boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, source_selector, field_context)
);

CREATE INDEX IF NOT EXISTS integration_fields_integration_idx
  ON app.integration_fields (integration_id, field_context, canonical_field);

ALTER TABLE app.api_keys
  ADD COLUMN IF NOT EXISTS integration_id text REFERENCES app.integrations(id) ON DELETE SET NULL;

ALTER TABLE app.api_keys
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'test';

ALTER TABLE app.api_keys
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS api_keys_integration_idx
  ON app.api_keys (integration_id, created_at DESC);

ALTER TABLE app.shadow_observations
  DROP CONSTRAINT IF EXISTS shadow_observations_operation_check;

ALTER TABLE app.shadow_observations
  ADD CONSTRAINT shadow_observations_operation_check
  CHECK (
    operation IN (
      'name.validate',
      'email.validate',
      'phone.validate',
      'address.validate',
      'company_id.validate'
    )
  );
