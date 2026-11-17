CREATE TABLE app.customer_email_identities (
  email text PRIMARY KEY CHECK(length(email) BETWEEN 3 AND 320),
  user_id text NOT NULL UNIQUE REFERENCES app.account_users(id)
);
CREATE TABLE app.customer_login_links (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  browser_hash text NOT NULL CHECK(browser_hash ~ '^[a-f0-9]{64}$'),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  consumed_at timestamptz
);
CREATE INDEX customer_login_links_email_time_idx ON app.customer_login_links(email, created_at);
CREATE TABLE app.customer_sessions (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  user_id text NOT NULL REFERENCES app.account_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '12 hours'
);
CREATE INDEX customer_sessions_user_idx ON app.customer_sessions(user_id);
