ALTER TABLE reference_cz.dataset_versions
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE reference_cz.addresses
  DROP CONSTRAINT IF EXISTS addresses_pkey;

ALTER TABLE reference_cz.addresses
  ADD CONSTRAINT addresses_pkey PRIMARY KEY (dataset_version_id, id);
