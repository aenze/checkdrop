-- A street field may complete a bare house number in a municipality without streets to the
-- official form "<část obce> <č. p.>" when RÚIAN confirms exactly one address point.
ALTER TABLE app.integration_fields
  ADD COLUMN fill_village_street boolean NOT NULL DEFAULT false;

ALTER TABLE app.integration_fields
  ADD CONSTRAINT integration_fields_village_street_check CHECK (
    NOT fill_village_street OR (
      canonical_field = 'street_line' AND validation_mode = 'suggest'
    )
  );
