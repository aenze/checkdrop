-- Searchable blind index for encrypted operator-only shadow values.
-- Only key-derived HMAC digests are stored; names, e-mails and other input values remain encrypted.
ALTER TABLE app.shadow_observations
  ADD COLUMN IF NOT EXISTS search_tokens text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS search_index_version smallint NOT NULL DEFAULT 0;

ALTER TABLE app.shadow_observations
  DROP CONSTRAINT IF EXISTS shadow_observations_search_tokens_bounded,
  DROP CONSTRAINT IF EXISTS shadow_observations_search_index_version;

ALTER TABLE app.shadow_observations
  ADD CONSTRAINT shadow_observations_search_tokens_bounded CHECK (
    cardinality(search_tokens) <= 256
    AND COALESCE(array_to_string(search_tokens, ''), '') ~ '^(?:[a-f0-9]{64})*$'
  ),
  ADD CONSTRAINT shadow_observations_search_index_version CHECK (
    search_index_version IN (0, 1)
  );

CREATE INDEX IF NOT EXISTS shadow_observations_search_tokens_idx
  ON app.shadow_observations USING gin (search_tokens)
  WHERE search_index_version = 1;
