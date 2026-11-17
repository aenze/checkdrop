ALTER TABLE app.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_client_name;

ALTER TABLE app.usage_events
  ADD CONSTRAINT usage_events_client_name
  CHECK (
    client_name IS NULL
    OR (
      client_name ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'
      AND client_name ~ '[A-Za-z]'
      AND client_name !~* '^cdp_'
    )
  );

ALTER TABLE app.usage_events
  ADD CONSTRAINT usage_events_request_id_format
  CHECK (
    request_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  );

ALTER TABLE app.usage_events
  ADD CONSTRAINT usage_events_idempotency_hash_format
  CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$');
