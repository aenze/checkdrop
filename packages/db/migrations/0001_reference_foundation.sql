CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS reference_cz;

CREATE TABLE IF NOT EXISTS reference_cz.dataset_versions (
  id text PRIMARY KEY,
  source text NOT NULL,
  version text NOT NULL,
  effective_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL CHECK (row_count >= 0),
  checksum text NOT NULL,
  state text NOT NULL CHECK (state IN ('staged', 'active', 'rejected')),
  UNIQUE (source, version)
);

CREATE TABLE IF NOT EXISTS reference_cz.addresses (
  id text PRIMARY KEY,
  dataset_version_id text NOT NULL REFERENCES reference_cz.dataset_versions(id),
  municipality text NOT NULL,
  municipality_part text,
  street text,
  house_number text NOT NULL,
  orientation_number text,
  postal_code text NOT NULL,
  search_full text NOT NULL,
  search_city text NOT NULL,
  search_street text NOT NULL
);

CREATE INDEX IF NOT EXISTS addresses_search_full_trgm
  ON reference_cz.addresses USING gin (search_full gin_trgm_ops);

CREATE INDEX IF NOT EXISTS addresses_search_city_trgm
  ON reference_cz.addresses USING gin (search_city gin_trgm_ops);
