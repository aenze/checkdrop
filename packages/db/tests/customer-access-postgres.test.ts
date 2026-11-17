import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCustomerAccessStore } from "../src/customer-access.js";
import { createCustomerEmailLoginStore } from "../src/customer-email-login.js";
import { createCustomerTeamStore } from "../src/customer-team.js";

const connection = process.env.CHECKDROP_ACCESS_TEST_DATABASE_URL;
describe.skipIf(!connection)("customer access on isolated PostgreSQL", () => {
  let pool: Pool;
  let store: ReturnType<typeof createCustomerAccessStore>;
  let team: ReturnType<typeof createCustomerTeamStore>;
  let login: ReturnType<typeof createCustomerEmailLoginStore>;
  const identity = { issuer: "https://issuer.test", subject: "user-a" };
  beforeAll(async () => {
    if (!connection) throw new Error("Test database URL required");
    const url = new URL(connection);
    if (url.pathname !== "/checkdrop_access_qa" || url.hostname !== "127.0.0.1") {
      throw new Error("Only a local, disposable checkdrop_access_qa database is allowed");
    }
    pool = new Pool({ connectionString: connection });
    // Intentionally fails if a schema already exists. Never clean or overwrite a database.
    await pool.query("CREATE SCHEMA app");
    await pool.query(
      readFileSync(
        new URL("../migrations/0027_customer_account_foundation.sql", import.meta.url),
        "utf8",
      ),
    );
    await pool.query(`
      INSERT INTO app.organizations (id,name) VALUES ('org-a','A'),('org-b','B');
      INSERT INTO app.account_users (id,identity_issuer,identity_subject) VALUES ('a','https://issuer.test','user-a');
      INSERT INTO app.organization_memberships (organization_id,user_id,role) VALUES ('org-a','a','owner');
      INSERT INTO app.organization_projects (project_ref,organization_id) VALUES ('project-a','org-a'),('project-b','org-b');
    `);
    store = createCustomerAccessStore(connection);
    team = createCustomerTeamStore(connection);
    login = createCustomerEmailLoginStore(connection);
    await pool.query(
      readFileSync(
        new URL("../migrations/0028_customer_membership_invitations.sql", import.meta.url),
        "utf8",
      ),
    );
    await pool.query(
      readFileSync(new URL("../migrations/0029_customer_email_login.sql", import.meta.url), "utf8"),
    );
  });
  afterAll(async () => {
    await store?.close();
    await team?.close();
    await login?.close();
    await pool?.end();
  });

  it("allows own project and rejects another organization, unknown project and issuer spoofing", async () => {
    expect(await store.authorize(identity, "project-a", "configure")).toEqual({
      organizationId: "org-a",
      projectRef: "project-a",
      role: "owner",
    });
    expect(await store.authorize(identity, "project-b", "read")).toBeNull();
    expect(await store.authorize(identity, "project-a' OR true --", "read")).toBeNull();
    expect(
      await store.authorize({ ...identity, issuer: "https://other.test" }, "project-a", "read"),
    ).toBeNull();
  });
  it("immediately respects role changes, revocation, suspension and disabled users", async () => {
    await pool.query("UPDATE app.organization_memberships SET role = 'viewer'");
    expect(await store.authorize(identity, "project-a", "configure")).toBeNull();
    expect(await store.authorize(identity, "project-a", "read")).not.toBeNull();
    await pool.query("UPDATE app.organization_memberships SET state = 'revoked'");
    expect(await store.authorize(identity, "project-a", "read")).toBeNull();
    await pool.query(
      "UPDATE app.organization_memberships SET state = 'active'; UPDATE app.organizations SET state = 'suspended' WHERE id = 'org-a'",
    );
    expect(await store.authorize(identity, "project-a", "read")).toBeNull();
    await pool.query(
      "UPDATE app.organizations SET state = 'active'; UPDATE app.account_users SET state = 'disabled'",
    );
    expect(await store.authorize(identity, "project-a", "read")).toBeNull();
  });

  let sequence = 0;
  async function seedTeam() {
    const org = `team-${++sequence}`;
    const ownerId = `${org}-owner`;
    const owner = { issuer: "https://issuer.test", subject: ownerId };
    await pool.query("INSERT INTO app.organizations(id,name) VALUES($1,$1)", [org]);
    await pool.query(
      "INSERT INTO app.account_users(id,identity_issuer,identity_subject) VALUES($1,$2,$1)",
      [ownerId, owner.issuer],
    );
    await pool.query(
      "INSERT INTO app.organization_memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",
      [org, ownerId],
    );
    return { org, ownerId, owner };
  }
  it("creates a browser-bound single-use email login for an invited member and revokes its session", async () => {
    const { org, owner } = await seedTeam();
    const email = `${org}@example.test`;
    await team.invite(owner, org, email, "viewer");
    const browser = "a".repeat(43);
    expect(await login.issue("unknown@example.test", browser)).toBeNull();
    const token = await login.issue(email, browser);
    if (!token) throw new Error("Expected invitation login");
    expect(await login.issue(email, browser)).toBeNull();
    expect(await login.consume(token, "b".repeat(43))).toBeNull();
    const results = await Promise.all([
      login.consume(token, browser),
      login.consume(token, browser),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const session = results.find(Boolean);
    if (!session) throw new Error("Expected session");
    expect((await login.verify(session.session))?.verifiedEmail).toBe(email);
    await login.revoke(session.session);
    expect(await login.verify(session.session)).toBeNull();
  });
  it("rejects an expired login and revoked invitation before account creation", async () => {
    const { org, owner } = await seedTeam();
    const email = `${org}@example.test`;
    const invitation = await team.invite(owner, org, email, "viewer");
    const browser = "a".repeat(43);
    const token = await login.issue(email, browser);
    if (!token) throw new Error("Expected invitation login");
    await team.revokeInvitation(owner, org, invitation.id);
    expect(await login.consume(token, browser)).toBeNull();
    await team.invite(owner, org, email, "viewer");
    await pool.query(
      "UPDATE app.customer_login_links SET expires_at=now()-interval '1 minute' WHERE email=$1",
      [email],
    );
    expect(await login.consume(token, browser)).toBeNull();
  });
  it("stores only a token hash, binds acceptance to verified email and prevents replay", async () => {
    const { org, owner } = await seedTeam();
    const invitation = await team.invite(owner, org, "Guest@Example.test", "viewer");
    const saved = await pool.query(
      "SELECT token_hash FROM app.organization_invitations WHERE id=$1",
      [invitation.id],
    );
    expect(saved.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.rows[0].token_hash).not.toBe(invitation.token);
    const guest = { issuer: owner.issuer, subject: `${org}-guest` };
    await expect(team.accept(guest, "wrong@example.test", invitation.token)).rejects.toMatchObject({
      code: "invalid_invitation",
    });
    expect(await team.accept(guest, "guest@example.test", invitation.token)).toEqual({
      organizationId: org,
      role: "viewer",
    });
    await expect(team.accept(guest, "guest@example.test", invitation.token)).rejects.toMatchObject({
      code: "invalid_invitation",
    });
  });
  it("rejects revoked, expired and replaced invitations", async () => {
    const { org, owner } = await seedTeam();
    const guest = { issuer: owner.issuer, subject: `${org}-guest` };
    const first = await team.invite(owner, org, "guest@example.test", "viewer");
    const second = await team.invite(owner, org, "guest@example.test", "admin");
    await expect(team.accept(guest, "guest@example.test", first.token)).rejects.toMatchObject({
      code: "invalid_invitation",
    });
    await team.revokeInvitation(owner, org, second.id);
    await expect(team.accept(guest, "guest@example.test", second.token)).rejects.toMatchObject({
      code: "invalid_invitation",
    });
    const third = await team.invite(owner, org, "guest@example.test", "viewer");
    await pool.query(
      "UPDATE app.organization_invitations SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [third.id],
    );
    await expect(team.accept(guest, "guest@example.test", third.token)).rejects.toMatchObject({
      code: "invalid_invitation",
    });
  });
  it("denies outsider team changes and protects the last owner", async () => {
    const { org, owner, ownerId } = await seedTeam();
    await expect(team.invite(identity, org, "guest@example.test", "admin")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(team.changeMember(owner, org, ownerId, null)).rejects.toMatchObject({
      code: "last_owner",
    });
    await expect(team.changeMember(owner, org, ownerId, "viewer")).rejects.toMatchObject({
      code: "last_owner",
    });
  });
  it("keeps one owner under simultaneous self-removal requests", async () => {
    const { org, owner, ownerId } = await seedTeam();
    const secondId = `${org}-second`;
    const second = { issuer: owner.issuer, subject: secondId };
    await pool.query(
      "INSERT INTO app.account_users(id,identity_issuer,identity_subject) VALUES($1,$2,$1)",
      [secondId, owner.issuer],
    );
    await pool.query(
      "INSERT INTO app.organization_memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",
      [org, secondId],
    );
    const results = await Promise.allSettled([
      team.changeMember(owner, org, ownerId, null),
      team.changeMember(second, org, secondId, null),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const remaining = await pool.query(
      "SELECT user_id FROM app.organization_memberships WHERE organization_id=$1 AND role='owner' AND state='active'",
      [org],
    );
    expect(remaining.rows).toHaveLength(1);
    const audit = await pool.query(
      "SELECT action FROM app.organization_access_audit WHERE organization_id=$1",
      [org],
    );
    expect(audit.rows).toEqual([{ action: "membership.changed" }]);
  });
});
