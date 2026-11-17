ALTER TABLE reference_cz.dataset_versions
  DROP CONSTRAINT IF EXISTS dataset_versions_state_check;

ALTER TABLE reference_cz.dataset_versions
  ADD CONSTRAINT dataset_versions_state_check
  CHECK (state IN ('staged', 'active', 'archived', 'rejected'));

ALTER TABLE reference_cz.addresses
  ADD COLUMN IF NOT EXISTS house_number_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_line text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS search_postal_code text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS addresses_dataset_version
  ON reference_cz.addresses (dataset_version_id);

CREATE INDEX IF NOT EXISTS addresses_search_street_trgm
  ON reference_cz.addresses USING gin (search_street gin_trgm_ops);

CREATE INDEX IF NOT EXISTS addresses_search_postal_code
  ON reference_cz.addresses (search_postal_code);

CREATE UNIQUE INDEX IF NOT EXISTS dataset_versions_one_active_source
  ON reference_cz.dataset_versions (source)
  WHERE state = 'active';

CREATE OR REPLACE VIEW reference_cz.addresses_active AS
SELECT
  address.id,
  address.dataset_version_id,
  address.municipality,
  address.municipality_part,
  address.street,
  address.house_number_type,
  address.house_number,
  address.orientation_number,
  address.postal_code,
  address.address_line,
  address.search_full,
  address.search_city,
  address.search_street,
  address.search_postal_code
FROM reference_cz.addresses AS address
INNER JOIN reference_cz.dataset_versions AS dataset
  ON dataset.id = address.dataset_version_id
WHERE dataset.state = 'active';
