import { Pool } from "pg";
import { interactivePoolOptions } from "./interactive-pool.js";

export type CustomerRole = "owner" | "admin" | "viewer";
export type CustomerPermission = "read" | "configure" | "manage_members";

/** Deny unknown roles/permissions; callers must resolve identity from verified authentication. */
export function customerRoleAllows(role: string, permission: string): boolean {
  if (permission === "read") return ["owner", "admin", "viewer"].includes(role);
  if (permission === "configure") return role === "owner" || role === "admin";
  if (permission === "manage_members") return role === "owner";
  return false;
}

export interface VerifiedCustomerIdentity {
  readonly issuer: string;
  readonly subject: string;
}

/** Foundation, not an authentication mechanism. Never trust an identity from request JSON. */
export function createCustomerAccessStore(connectionString: string) {
  const pool = new Pool({ ...interactivePoolOptions, connectionString, max: 3 });
  return {
    async authorize(
      identity: VerifiedCustomerIdentity,
      projectRef: string,
      permission: CustomerPermission,
    ): Promise<{ organizationId: string; projectRef: string; role: CustomerRole } | null> {
      if (!identity.issuer || !identity.subject || !projectRef) return null;
      const result = await pool.query<{ organization_id: string; role: CustomerRole }>(
        `SELECT o.id AS organization_id, m.role
         FROM app.account_users u
         JOIN app.organization_memberships m ON m.user_id = u.id AND m.state = 'active'
         JOIN app.organizations o ON o.id = m.organization_id AND o.state = 'active'
         JOIN app.organization_projects p ON p.organization_id = o.id
         WHERE u.identity_issuer = $1 AND u.identity_subject = $2
           AND u.state = 'active' AND p.project_ref = $3`,
        [identity.issuer, identity.subject, projectRef],
      );
      const row = result.rows[0];
      if (!row || !customerRoleAllows(row.role, permission)) return null;
      return { organizationId: row.organization_id, projectRef, role: row.role };
    },
    close: () => pool.end(),
  };
}
