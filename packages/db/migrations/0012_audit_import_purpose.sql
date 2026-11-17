ALTER TABLE app.audit_imports
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'user';

UPDATE app.audit_imports
SET purpose = 'test'
WHERE file_name ~* '(^|[-_.])(qa|test|smoke)([-_.]|$)'
   OR file_name ~* '^checkdrop-staging-'
   OR file_name ~* '^checkdrop-duplicates-';

ALTER TABLE app.audit_imports
  ADD CONSTRAINT audit_imports_purpose CHECK (purpose IN ('user', 'test'));

CREATE INDEX IF NOT EXISTS audit_imports_project_purpose_created_idx
  ON app.audit_imports (project_ref, purpose, created_at DESC);
