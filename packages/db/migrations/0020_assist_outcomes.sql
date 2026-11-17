-- Customer assist decisions are attached to the encrypted observation that already contains the
-- concrete input and proposal. This keeps the operator audit identifiable without duplicating PII.
ALTER TABLE app.shadow_observations
  ADD COLUMN IF NOT EXISTS assist_shown_at timestamptz,
  ADD COLUMN IF NOT EXISTS assist_outcome text,
  ADD COLUMN IF NOT EXISTS assist_outcome_at timestamptz;

ALTER TABLE app.shadow_observations
  DROP CONSTRAINT IF EXISTS shadow_observations_assist_outcome_check,
  DROP CONSTRAINT IF EXISTS shadow_observations_assist_timeline_check;

ALTER TABLE app.shadow_observations
  ADD CONSTRAINT shadow_observations_assist_outcome_check CHECK (
    assist_outcome IS NULL OR assist_outcome IN ('applied', 'kept', 'undone')
  ),
  ADD CONSTRAINT shadow_observations_assist_timeline_check CHECK (
    (assist_outcome IS NULL AND assist_outcome_at IS NULL)
    OR (
      assist_outcome IS NOT NULL
      AND assist_shown_at IS NOT NULL
      AND assist_outcome_at IS NOT NULL
      AND assist_outcome_at >= assist_shown_at
    )
  );

CREATE INDEX IF NOT EXISTS shadow_observations_project_assist_idx
  ON app.shadow_observations (project_ref, assist_outcome, assist_outcome_at DESC)
  WHERE assist_shown_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shadow_observations_key_request_idx
  ON app.shadow_observations (api_key_id, request_id);
