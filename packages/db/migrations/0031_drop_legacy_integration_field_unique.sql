-- 0017 meant to replace the per-integration selector uniqueness from 0015 with a per-form one, but
-- dropped it by the name "integration_fields_integration_id_source_selector_field_context_key".
-- That name has 67 characters; PostgreSQL truncates generated names to 63, so DROP ... IF EXISTS
-- matched nothing and the old constraint stayed. Two forms of one site could then not map the
-- same selector (saving failed with 500). Find the constraint by its columns, not by its name.
DO $$
DECLARE
  legacy record;
BEGIN
  FOR legacy IN
    SELECT constraint_row.conname
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'app.integration_fields'::regclass
      AND constraint_row.contype = 'u'
      AND (
        SELECT array_agg(attribute.attname::text ORDER BY attribute.attname)
        FROM unnest(constraint_row.conkey) AS key_column(attnum)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = key_column.attnum
      ) = ARRAY['field_context', 'integration_id', 'source_selector']
  LOOP
    EXECUTE format('ALTER TABLE app.integration_fields DROP CONSTRAINT %I', legacy.conname);
  END LOOP;
END $$;

-- The per-form uniqueness from 0017 stays the only rule.
CREATE UNIQUE INDEX IF NOT EXISTS integration_fields_form_selector_context_idx
  ON app.integration_fields (form_id, source_selector, field_context);
