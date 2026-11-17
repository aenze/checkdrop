ALTER TABLE app.integration_fields
  DROP CONSTRAINT IF EXISTS integration_fields_canonical_field_check;

ALTER TABLE app.integration_fields
  ADD CONSTRAINT integration_fields_canonical_field_check CHECK (canonical_field IN (
    'customer_type', 'full_name', 'first_name', 'last_name', 'email', 'phone',
    'street_line', 'city', 'postal_code', 'country', 'company_id', 'company_name',
    'vat_id', 'profile_details_enabled', 'alternate_shipping_enabled', 'unmapped'
  ));

ALTER TABLE app.integration_forms
  ADD COLUMN IF NOT EXISTS root_selector text NOT NULL DEFAULT 'body';

ALTER TABLE app.integration_forms
  DROP CONSTRAINT IF EXISTS integration_forms_root_selector_check,
  DROP CONSTRAINT IF EXISTS integration_forms_integration_id_match_mode_path_pattern_key;

ALTER TABLE app.integration_forms
  ADD CONSTRAINT integration_forms_root_selector_check CHECK (
    char_length(root_selector) BETWEEN 1 AND 512
  ),
  ADD CONSTRAINT integration_forms_path_root_unique UNIQUE (
    integration_id, match_mode, path_pattern, root_selector
  );

DROP INDEX IF EXISTS app.integration_forms_match_idx;

CREATE INDEX integration_forms_match_idx
  ON app.integration_forms (integration_id, state, match_mode, path_pattern, root_selector);

ALTER TABLE app.shadow_observations
  ADD COLUMN IF NOT EXISTS assist_changed_fields text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE app.shadow_observations
  DROP CONSTRAINT IF EXISTS shadow_observations_assist_changed_fields_check;

ALTER TABLE app.shadow_observations
  ADD CONSTRAINT shadow_observations_assist_changed_fields_check CHECK (
    cardinality(assist_changed_fields) <= 16
    AND assist_changed_fields <@ ARRAY[
      'first_name', 'last_name', 'full_name', 'company_name', 'company_id', 'vat_id',
      'street_line', 'city', 'postal_code', 'country'
    ]::text[]
  );
