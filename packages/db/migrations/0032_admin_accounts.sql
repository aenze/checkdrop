CREATE TABLE app.admin_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (char_length(email) BETWEEN 3 AND 320 AND email = lower(email)),
  password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz
);

CREATE TABLE app.admin_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id text NOT NULL REFERENCES app.admin_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX admin_sessions_user_idx ON app.admin_sessions (user_id);
CREATE INDEX admin_sessions_expires_idx ON app.admin_sessions (expires_at);
