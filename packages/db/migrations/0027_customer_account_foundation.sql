-- Additive foundation only: no automatic assignment of legacy project data or users.
-- Authentication and endpoint authorization must be wired before customer access opens.
CREATE TABLE app.organizations (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.account_users (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  identity_issuer text NOT NULL CHECK (length(identity_issuer) BETWEEN 1 AND 2048),
  identity_subject text NOT NULL CHECK (length(identity_subject) BETWEEN 1 AND 512),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_issuer, identity_subject)
);

CREATE TABLE app.organization_memberships (
  organization_id text NOT NULL REFERENCES app.organizations(id),
  user_id text NOT NULL REFERENCES app.account_users(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX organization_memberships_user_idx ON app.organization_memberships(user_id);

CREATE TABLE app.organization_projects (
  project_ref text PRIMARY KEY CHECK (length(project_ref) BETWEEN 1 AND 128),
  organization_id text NOT NULL REFERENCES app.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_projects_org_idx ON app.organization_projects(organization_id);
