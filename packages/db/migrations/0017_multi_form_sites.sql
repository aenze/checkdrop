CREATE TABLE IF NOT EXISTS app.integration_forms (
  id text PRIMARY KEY,
  integration_id text NOT NULL REFERENCES app.integrations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  form_url text NOT NULL CHECK (char_length(form_url) BETWEEN 8 AND 2048),
  match_mode text NOT NULL DEFAULT 'exact' CHECK (match_mode IN ('exact', 'prefix')),
  path_pattern text NOT NULL CHECK (
    char_length(path_pattern) BETWEEN 1 AND 1024
    AND path_pattern LIKE '/%'
    AND path_pattern NOT LIKE '%?%'
    AND path_pattern NOT LIKE '%#%'
  ),
  state text NOT NULL DEFAULT 'draft' CHECK (
    state IN ('draft', 'scanned', 'configured', 'paused')
  ),
  config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, match_mode, path_pattern)
);

CREATE UNIQUE INDEX IF NOT EXISTS integration_forms_one_default_idx
  ON app.integration_forms (integration_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS integration_forms_match_idx
  ON app.integration_forms (integration_id, state, match_mode, path_pattern);

INSERT INTO app.integration_forms (
  id, integration_id, name, form_url, match_mode, path_pattern, state,
  config_version, is_default, created_at, updated_at
)
SELECT
  integration.id || '-form-1',
  integration.id,
  CASE
    WHEN integration.name ~ ' [–-] ' THEN regexp_replace(integration.name, '^.* [–-] ', '')
    ELSE 'Hlavní formulář'
  END,
  integration.form_url,
  'exact',
  CASE
    WHEN path.raw_path = '' OR path.raw_path ~ '^/+$' THEN '/'
    ELSE regexp_replace(path.raw_path, '/+$', '')
  END,
  CASE
    WHEN integration.state = 'draft' THEN 'draft'
    WHEN integration.state = 'scanned' THEN 'scanned'
    WHEN integration.state = 'paused' THEN 'paused'
    ELSE 'configured'
  END,
  integration.config_version,
  true,
  integration.created_at,
  integration.updated_at
FROM app.integrations AS integration
CROSS JOIN LATERAL (
  SELECT regexp_replace(
    regexp_replace(integration.form_url, '^https?://[^/]+', ''),
    '[?#].*$',
    ''
  ) AS raw_path
) AS path
ON CONFLICT (id) DO NOTHING;

ALTER TABLE app.integration_fields
  ADD COLUMN IF NOT EXISTS form_id text REFERENCES app.integration_forms(id) ON DELETE CASCADE;

UPDATE app.integration_fields AS field
SET form_id = form.id
FROM app.integration_forms AS form
WHERE field.integration_id = form.integration_id
  AND form.is_default
  AND field.form_id IS NULL;

ALTER TABLE app.integration_fields
  ALTER COLUMN form_id SET NOT NULL;

ALTER TABLE app.integration_fields
  DROP CONSTRAINT IF EXISTS integration_fields_integration_id_source_selector_field_context_key;

CREATE UNIQUE INDEX IF NOT EXISTS integration_fields_form_selector_context_idx
  ON app.integration_fields (form_id, source_selector, field_context);

ALTER TABLE app.form_scans
  ADD COLUMN IF NOT EXISTS form_id text REFERENCES app.integration_forms(id) ON DELETE CASCADE;

UPDATE app.form_scans AS scan
SET form_id = form.id
FROM app.integration_forms AS form
WHERE scan.integration_id = form.integration_id
  AND form.is_default
  AND scan.form_id IS NULL;

ALTER TABLE app.form_scans
  ALTER COLUMN form_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS form_scans_form_created_idx
  ON app.form_scans (form_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.integration_form_config_versions (
  form_id text NOT NULL REFERENCES app.integration_forms(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, version)
);

CREATE INDEX IF NOT EXISTS integration_form_config_versions_created_idx
  ON app.integration_form_config_versions (form_id, created_at DESC);

INSERT INTO app.integration_form_config_versions (form_id, version, fields, created_at)
SELECT form.id, version.version, version.fields, version.created_at
FROM app.integration_config_versions AS version
JOIN app.integration_forms AS form
  ON form.integration_id = version.integration_id
 AND form.is_default
ON CONFLICT (form_id, version) DO NOTHING;

ALTER TABLE app.shadow_observations
  ADD COLUMN IF NOT EXISTS form_id text REFERENCES app.integration_forms(id) ON DELETE SET NULL;

UPDATE app.shadow_observations AS observation
SET form_id = form.id
FROM app.api_keys AS key
JOIN app.integration_forms AS form
  ON form.integration_id = key.integration_id
 AND form.is_default
WHERE observation.api_key_id = key.id
  AND observation.form_id IS NULL;

CREATE INDEX IF NOT EXISTS shadow_observations_form_created_idx
  ON app.shadow_observations (form_id, created_at DESC);
