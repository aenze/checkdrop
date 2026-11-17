CREATE TABLE IF NOT EXISTS app.integration_config_versions (
  integration_id text NOT NULL REFERENCES app.integrations(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, version)
);

CREATE INDEX IF NOT EXISTS integration_config_versions_created_idx
  ON app.integration_config_versions (integration_id, created_at DESC);

INSERT INTO app.integration_config_versions (integration_id, version, fields, created_at)
SELECT
  integration.id,
  integration.config_version,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', field.id,
          'sourceSelector', field.source_selector,
          'sourceLabel', field.source_label,
          'sourceName', field.source_name,
          'canonicalField', field.canonical_field,
          'context', field.field_context,
          'conditionKey', field.condition_key,
          'required', field.required,
          'validationMode', field.validation_mode,
          'validationTrigger', field.validation_trigger,
          'confidence', field.confidence,
          'detected', field.detected
        )
        ORDER BY field.field_context, field.source_label, field.source_selector
      )
      FROM app.integration_fields AS field
      WHERE field.integration_id = integration.id
    ),
    '[]'::jsonb
  ),
  integration.updated_at
FROM app.integrations AS integration
ON CONFLICT (integration_id, version) DO NOTHING;
