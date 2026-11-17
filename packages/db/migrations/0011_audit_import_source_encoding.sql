ALTER TABLE app.audit_imports
  ADD COLUMN IF NOT EXISTS source_encoding text NOT NULL DEFAULT 'utf-8';

ALTER TABLE app.audit_imports
  DROP CONSTRAINT IF EXISTS audit_imports_source_encoding;

ALTER TABLE app.audit_imports
  ADD CONSTRAINT audit_imports_source_encoding CHECK (
    source_encoding IN ('utf-8', 'windows-1250', 'utf-16le', 'utf-16be')
  );
