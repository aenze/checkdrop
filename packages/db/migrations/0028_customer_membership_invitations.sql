CREATE TABLE app.organization_invitations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES app.organizations(id),
  invited_by text NOT NULL REFERENCES app.account_users(id),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  role text NOT NULL CHECK (role IN ('admin', 'viewer')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_invitations_org_idx ON app.organization_invitations(organization_id);

CREATE TABLE app.organization_access_audit (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES app.organizations(id),
  actor_user_id text NOT NULL REFERENCES app.account_users(id),
  action text NOT NULL CHECK (action IN ('invitation.created','invitation.accepted','invitation.revoked','membership.changed')),
  target_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_access_audit_org_time_idx ON app.organization_access_audit(organization_id, created_at);
