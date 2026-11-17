CREATE TABLE app.instance_jobs (
  name text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9-]{1,40}$'),
  state text NOT NULL CHECK (state IN ('running', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  message text CHECK (message IS NULL OR char_length(message) <= 500)
);
