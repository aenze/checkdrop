ALTER TABLE app.audit_imports
  ALTER COLUMN dataset DROP NOT NULL,
  ALTER COLUMN corrected_csv DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS source_csv text,
  ADD COLUMN IF NOT EXISTS idempotency_key_hash text,
  ADD COLUMN IF NOT EXISTS progress_phase text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS processed_records integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_records integer,
  ADD COLUMN IF NOT EXISTS summary jsonb,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_token text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS app.audit_import_rows (
  import_id text NOT NULL REFERENCES app.audit_imports(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  status text NOT NULL CHECK (status IN ('corrected', 'warning', 'invalid', 'clean')),
  search_text text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (import_id, ordinal)
);

CREATE INDEX IF NOT EXISTS audit_import_rows_status_idx
  ON app.audit_import_rows (import_id, status, ordinal);

CREATE INDEX IF NOT EXISTS audit_import_rows_search_trgm
  ON app.audit_import_rows USING gin (search_text gin_trgm_ops);

INSERT INTO app.audit_import_rows (import_id, ordinal, status, search_text, payload)
SELECT
  import_row.id,
  result.ordinality::integer,
  result.payload->>'status',
  lower(concat_ws(' ',
    result.payload->>'identity',
    result.payload->>'original',
    result.payload->>'corrected',
    result.payload->>'reason',
    result.payload->>'fieldLabel',
    result.payload->>'source'
  )),
  result.payload
FROM app.audit_imports AS import_row
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(import_row.dataset->'rows', '[]'::jsonb))
  WITH ORDINALITY AS result(payload, ordinality)
ON CONFLICT (import_id, ordinal) DO NOTHING;

WITH result_summary AS (
  SELECT
    import_id,
    count(*)::integer AS total,
    count(*) FILTER (WHERE status = 'corrected')::integer AS corrected,
    count(*) FILTER (WHERE status = 'warning')::integer AS warning,
    count(*) FILTER (WHERE status = 'invalid')::integer AS invalid,
    count(*) FILTER (WHERE status = 'clean')::integer AS clean
  FROM app.audit_import_rows
  GROUP BY import_id
)
UPDATE app.audit_imports AS import_row
SET
  dataset = jsonb_set(import_row.dataset, '{rows}', '[]'::jsonb),
  summary = jsonb_build_object(
    'total', coalesce(result_summary.total, 0),
    'corrected', coalesce(result_summary.corrected, 0),
    'warning', coalesce(result_summary.warning, 0),
    'invalid', coalesce(result_summary.invalid, 0),
    'clean', coalesce(result_summary.clean, 0)
  ),
  processed_records = import_row.source_records,
  total_records = import_row.source_records,
  completed_at = import_row.created_at,
  updated_at = now()
FROM result_summary
WHERE import_row.id = result_summary.import_id;

UPDATE app.audit_imports
SET
  dataset = jsonb_set(dataset, '{rows}', '[]'::jsonb),
  summary = jsonb_build_object(
    'total', 0,
    'corrected', 0,
    'warning', 0,
    'invalid', 0,
    'clean', 0
  ),
  processed_records = source_records,
  total_records = source_records,
  completed_at = created_at,
  updated_at = now()
WHERE summary IS NULL;

ALTER TABLE app.audit_imports
  ADD CONSTRAINT audit_imports_state CHECK (
    state IN ('queued', 'processing', 'completed', 'failed')
  ),
  ADD CONSTRAINT audit_imports_progress CHECK (
    processed_records >= 0
    AND (total_records IS NULL OR total_records >= processed_records)
  ),
  ADD CONSTRAINT audit_imports_attempts CHECK (attempts BETWEEN 0 AND 3),
  ADD CONSTRAINT audit_imports_idempotency_hash CHECK (
    idempotency_key_hash IS NULL OR idempotency_key_hash ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT audit_imports_payload_lifecycle CHECK (
    (state IN ('queued', 'processing') AND source_csv IS NOT NULL)
    OR (state IN ('completed', 'failed') AND source_csv IS NULL)
  ),
  ADD CONSTRAINT audit_imports_result_lifecycle CHECK (
    (state = 'completed' AND dataset IS NOT NULL AND corrected_csv IS NOT NULL AND summary IS NOT NULL)
    OR (state <> 'completed' AND dataset IS NULL AND corrected_csv IS NULL)
  ),
  ADD CONSTRAINT audit_imports_lease_lifecycle CHECK (
    (state = 'processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (state <> 'processing' AND lease_token IS NULL AND lease_until IS NULL)
  ),
  ADD CONSTRAINT audit_imports_error_length CHECK (
    error_message IS NULL OR char_length(error_message) BETWEEN 1 AND 500
  );

CREATE UNIQUE INDEX IF NOT EXISTS audit_imports_idempotency_idx
  ON app.audit_imports (project_ref, idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_imports_queue_idx
  ON app.audit_imports (state, created_at)
  WHERE state IN ('queued', 'processing');
