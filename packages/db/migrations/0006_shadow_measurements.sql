ALTER TABLE app.usage_events
  ADD COLUMN IF NOT EXISTS integration_mode text NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS duration_ms integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE app.usage_events
    ADD CONSTRAINT usage_events_integration_mode
    CHECK (integration_mode IN ('api', 'shadow'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE app.usage_events
    ADD CONSTRAINT usage_events_client_name
    CHECK (
      client_name IS NULL
      OR client_name ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE app.usage_events
    ADD CONSTRAINT usage_events_duration_ms
    CHECK (duration_ms >= 0 AND duration_ms <= 300000);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS usage_events_shadow_measurement_idx
  ON app.usage_events (project_ref, integration_mode, created_at DESC);
