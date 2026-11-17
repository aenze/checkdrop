import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { CustomerRole, VerifiedCustomerIdentity } from "./customer-access.js";
import { interactivePoolOptions } from "./interactive-pool.js";

export class CustomerTeamError extends Error {
  constructor(
    readonly code:
      | "forbidden"
      | "invalid_invitation"
      | "last_owner"
      | "invalid_input"
      | "already_member",
  ) {
    super(code);
  }
}
function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createCustomerTeamStore(connectionString: string) {
  const pool = new Pool({ ...interactivePoolOptions, connectionString, max: 3 });
  async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async function owner(client: PoolClient, identity: VerifiedCustomerIdentity, org: string) {
    // Serialize all team changes on the organization row, including concurrent owner removal.
    const locked = await client.query(
      "SELECT id FROM app.organizations WHERE id=$1 AND state='active' FOR UPDATE",
      [org],
    );
    if (!locked.rows.length) throw new CustomerTeamError("forbidden");
    const member = await client.query<{ id: string }>(
      `SELECT u.id FROM app.account_users u JOIN app.organization_memberships m ON m.user_id=u.id WHERE u.identity_issuer=$1 AND u.identity_subject=$2 AND u.state='active' AND m.organization_id=$3 AND m.state='active' AND m.role='owner'`,
      [identity.issuer, identity.subject, org],
    );
    if (!member.rows[0]) throw new CustomerTeamError("forbidden");
    return member.rows[0].id;
  }
  async function audit(
    client: PoolClient,
    org: string,
    actor: string,
    action: string,
    target: string,
  ) {
    await client.query(
      "INSERT INTO app.organization_access_audit(id,organization_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), org, actor, action, target],
    );
  }
  return {
    async invite(
      identity: VerifiedCustomerIdentity,
      org: string,
      emailInput: string,
      role: "admin" | "viewer",
    ) {
      const email = emailInput.trim().toLowerCase();
      if (
        email.length > 320 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !["admin", "viewer"].includes(role)
      )
        throw new CustomerTeamError("invalid_input");
      return transaction(async (client) => {
        const actor = await owner(client, identity, org);
        const token = randomBytes(32).toString("base64url");
        const id = randomUUID();
        // Replace any outstanding invitation for the same address; old links cannot grant access.
        const replaced = await client.query<{ id: string }>(
          "UPDATE app.organization_invitations SET revoked_at=now() WHERE organization_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id",
          [org, email],
        );
        for (const previous of replaced.rows)
          await audit(client, org, actor, "invitation.revoked", previous.id);
        await client.query(
          "INSERT INTO app.organization_invitations(id,organization_id,invited_by,email,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days')",
          [id, org, actor, email, role, hash(token)],
        );
        await audit(client, org, actor, "invitation.created", id);
        return { id, token }; // Return once to a trusted delivery layer, never store or log the token.
      });
    },
    async revokeInvitation(identity: VerifiedCustomerIdentity, org: string, id: string) {
      return transaction(async (client) => {
        const actor = await owner(client, identity, org);
        const result = await client.query(
          "UPDATE app.organization_invitations SET revoked_at=now() WHERE id=$1 AND organization_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id",
          [id, org],
        );
        if (!result.rows.length) throw new CustomerTeamError("invalid_invitation");
        await audit(client, org, actor, "invitation.revoked", id);
      });
    },
    /** verifiedEmail must come from the trusted login verifier, never from request JSON. */
    async accept(identity: VerifiedCustomerIdentity, verifiedEmail: string, token: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !verifiedEmail)
        throw new CustomerTeamError("invalid_invitation");
      return transaction(async (client) => {
        const lookup = await client.query<{ organization_id: string }>(
          "SELECT organization_id FROM app.organization_invitations WHERE token_hash=$1",
          [hash(token)],
        );
        const org = lookup.rows[0]?.organization_id;
        if (!org) throw new CustomerTeamError("invalid_invitation");
        const active = await client.query(
          "SELECT id FROM app.organizations WHERE id=$1 AND state='active' FOR UPDATE",
          [org],
        );
        if (!active.rows.length) throw new CustomerTeamError("invalid_invitation");
        const invitation = await client.query<{ id: string; role: "admin" | "viewer" }>(
          `SELECT i.id,i.role FROM app.organization_invitations i JOIN app.organization_memberships m ON m.organization_id=i.organization_id AND m.user_id=i.invited_by JOIN app.account_users inviter ON inviter.id=m.user_id WHERE i.token_hash=$1 AND i.email=$2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND m.state='active' AND m.role='owner' AND inviter.state='active' FOR UPDATE OF i`,
          [hash(token), verifiedEmail.trim().toLowerCase()],
        );
        const invited = invitation.rows[0];
        if (!invited) throw new CustomerTeamError("invalid_invitation");
        await client.query(
          "INSERT INTO app.account_users(id,identity_issuer,identity_subject) VALUES($1,$2,$3) ON CONFLICT(identity_issuer,identity_subject) DO NOTHING",
          [randomUUID(), identity.issuer, identity.subject],
        );
        const user = await client.query<{ id: string }>(
          "SELECT id FROM app.account_users WHERE identity_issuer=$1 AND identity_subject=$2 AND state='active' FOR UPDATE",
          [identity.issuer, identity.subject],
        );
        const userId = user.rows[0]?.id;
        if (!userId) throw new CustomerTeamError("forbidden");
        const existing = await client.query(
          "SELECT user_id FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND state='active'",
          [org, userId],
        );
        if (existing.rows.length) throw new CustomerTeamError("already_member");
        await client.query(
          "INSERT INTO app.organization_memberships(organization_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role,state='active'",
          [org, userId, invited.role],
        );
        await client.query(
          "UPDATE app.organization_invitations SET accepted_at=now() WHERE id=$1",
          [invited.id],
        );
        await audit(client, org, userId, "invitation.accepted", invited.id);
        return { organizationId: org, role: invited.role };
      });
    },
    async changeMember(
      identity: VerifiedCustomerIdentity,
      org: string,
      userId: string,
      role: CustomerRole | null,
    ) {
      if (role !== null && !["owner", "admin", "viewer"].includes(role))
        throw new CustomerTeamError("invalid_input");
      return transaction(async (client) => {
        const actor = await owner(client, identity, org);
        const member = await client.query<{ role: CustomerRole }>(
          "SELECT role FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND state='active'",
          [org, userId],
        );
        if (!member.rows[0]) throw new CustomerTeamError("forbidden");
        if (member.rows[0].role === "owner" && role !== "owner") {
          const owners = await client.query(
            "SELECT m.user_id FROM app.organization_memberships m JOIN app.account_users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.role='owner' AND m.state='active' AND u.state='active'",
            [org],
          );
          if (owners.rows.length <= 1) throw new CustomerTeamError("last_owner");
        }
        await client.query(
          "UPDATE app.organization_memberships SET role=COALESCE($3,role),state=$4 WHERE organization_id=$1 AND user_id=$2",
          [org, userId, role, role === null ? "revoked" : "active"],
        );
        await audit(client, org, actor, "membership.changed", userId);
      });
    },
    close: () => pool.end(),
  };
}
