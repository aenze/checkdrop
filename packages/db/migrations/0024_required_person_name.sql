ALTER TABLE app.integration_fields
  ADD COLUMN require_complete_name boolean NOT NULL DEFAULT false,
  ADD COLUMN submit_selector text;

ALTER TABLE app.integration_fields
  ADD CONSTRAINT integration_fields_required_person_name_check CHECK (
    NOT require_complete_name OR (
      canonical_field IN ('full_name', 'first_name', 'last_name') AND validation_mode <> 'off'
    )
  ),
  ADD CONSTRAINT integration_fields_submit_selector_check CHECK (
    submit_selector IS NULL OR char_length(submit_selector) BETWEEN 1 AND 512
  );
