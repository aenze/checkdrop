-- Group independent field validations from one checkout without storing the browser session token.
-- The application stores only a key-scoped HMAC reference, so the value cannot be used outside
-- Checkdrop to recover or impersonate the browser session.
ALTER TABLE app.shadow_observations
  ADD COLUMN IF NOT EXISTS checkout_session_ref text;

ALTER TABLE app.shadow_observations
  DROP CONSTRAINT IF EXISTS shadow_observations_checkout_session_ref_format;

ALTER TABLE app.shadow_observations
  ADD CONSTRAINT shadow_observations_checkout_session_ref_format CHECK (
    checkout_session_ref IS NULL OR checkout_session_ref ~ '^[a-f0-9]{64}$'
  );

CREATE INDEX IF NOT EXISTS shadow_observations_project_session_created_idx
  ON app.shadow_observations (project_ref, checkout_session_ref, created_at DESC)
  WHERE checkout_session_ref IS NOT NULL;
