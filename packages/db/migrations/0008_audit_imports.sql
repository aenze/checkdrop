CREATE TABLE IF NOT EXISTS app.audit_imports (
  id text PRIMARY KEY,
  project_ref text NOT NULL,
  file_name text NOT NULL,
  dataset jsonb NOT NULL,
  corrected_csv text NOT NULL,
  source_records integer NOT NULL CHECK (source_records >= 0),
  output_records integer NOT NULL CHECK (output_records >= 0),
  merged_records integer NOT NULL CHECK (merged_records >= 0),
  possible_duplicates integer NOT NULL CHECK (possible_duplicates >= 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT audit_imports_id_format CHECK (
    id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  ),
  CONSTRAINT audit_imports_file_name CHECK (
    char_length(file_name) BETWEEN 1 AND 255
    AND file_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT audit_imports_dataset_object CHECK (jsonb_typeof(dataset) = 'object'),
  CONSTRAINT audit_imports_retention CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS audit_imports_project_created_idx
  ON app.audit_imports (project_ref, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_imports_expires_idx
  ON app.audit_imports (expires_at);
