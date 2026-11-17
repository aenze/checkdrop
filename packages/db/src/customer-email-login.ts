import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { interactivePoolOptions } from "./interactive-pool.js";

export const CUSTOMER_EMAIL_ISSUER = "urn:checkdrop:email-login";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const validSecret = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);

export function createCustomerEmailLoginStore(connectionString: string) {
  const pool = new Pool({ ...interactivePoolOptions, connectionString, max: 3 });
  async function eligible(client: Pick<Pool, "query">, email: string) {
    const result = await client.query(
      `SELECT 1 FROM app.customer_email_identities e JOIN app.account_users u ON u.id=e.user_id JOIN app.organization_memberships m ON m.user_id=u.id JOIN app.organizations o ON o.id=m.organization_id WHERE e.email=$1 AND u.state='active' AND m.state='active' AND o.state='active'
      UNION ALL SELECT 1 FROM app.organization_invitations i JOIN app.organizations o ON o.id=i.organization_id JOIN app.organization_memberships m ON m.organization_id=i.organization_id AND m.user_id=i.invited_by JOIN app.account_users u ON u.id=m.user_id WHERE i.email=$1 AND i.expires_at>now() AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND o.state='active' AND m.state='active' AND m.role='owner' AND u.state='active' LIMIT 1`,
      [email],
    );
    return result.rows.length > 0;
  }
  return {
    /** Only invited/existing members. Null also covers cooldown; HTTP must not enumerate accounts. */
    async issue(emailInput: string, browserSecret: string) {
      const email = emailInput.trim().toLowerCase();
      if (
        !validSecret(browserSecret) ||
        email.length > 320 ||
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
      )
        return null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `login:${email}`,
        ]);
        if (!(await eligible(client, email))) {
          await client.query("ROLLBACK");
          return null;
        }
        const recent = await client.query(
          "SELECT 1 FROM app.customer_login_links WHERE email=$1 AND created_at>now()-interval '1 minute' LIMIT 1",
          [email],
        );
        if (recent.rows.length) {
          await client.query("ROLLBACK");
          return null;
        }
        const token = secret();
        await client.query(
          "INSERT INTO app.customer_login_links(token_hash,browser_hash,email) VALUES($1,$2,$3)",
          [digest(token), digest(browserSecret), email],
        );
        await client.query("COMMIT");
        return token;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async consume(token: string, browserSecret: string) {
      if (!validSecret(token) || !validSecret(browserSecret)) return null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<{ email: string }>(
          "UPDATE app.customer_login_links SET consumed_at=now() WHERE token_hash=$1 AND browser_hash=$2 AND expires_at>now() AND consumed_at IS NULL RETURNING email",
          [digest(token), digest(browserSecret)],
        );
        const email = result.rows[0]?.email;
        if (!email || !(await eligible(client, email))) {
          await client.query("ROLLBACK");
          return null;
        }
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `identity:${email}`,
        ]);
        let user = (
          await client.query<{ id: string; state: string }>(
            "SELECT u.id,u.state FROM app.customer_email_identities e JOIN app.account_users u ON u.id=e.user_id WHERE e.email=$1",
            [email],
          )
        ).rows[0];
        if (!user) {
          const id = randomUUID();
          await client.query(
            "INSERT INTO app.account_users(id,identity_issuer,identity_subject) VALUES($1,$2,$1)",
            [id, CUSTOMER_EMAIL_ISSUER],
          );
          await client.query(
            "INSERT INTO app.customer_email_identities(email,user_id) VALUES($1,$2)",
            [email, id],
          );
          user = { id, state: "active" };
        }
        if (user.state !== "active") {
          await client.query("ROLLBACK");
          return null;
        }
        const session = secret();
        await client.query("INSERT INTO app.customer_sessions(token_hash,user_id) VALUES($1,$2)", [
          digest(session),
          user.id,
        ]);
        await client.query("COMMIT");
        return {
          session,
          identity: { issuer: CUSTOMER_EMAIL_ISSUER, subject: user.id },
          verifiedEmail: email,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async verify(session: string) {
      if (!validSecret(session)) return null;
      const result = await pool.query<{ id: string; email: string }>(
        "SELECT u.id,e.email FROM app.customer_sessions s JOIN app.account_users u ON u.id=s.user_id JOIN app.customer_email_identities e ON e.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.state='active'",
        [digest(session)],
      );
      const user = result.rows[0];
      return user
        ? {
            identity: { issuer: CUSTOMER_EMAIL_ISSUER, subject: user.id },
            verifiedEmail: user.email,
          }
        : null;
    },
    async revoke(session: string) {
      if (validSecret(session))
        await pool.query("DELETE FROM app.customer_sessions WHERE token_hash=$1", [
          digest(session),
        ]);
    },
    async revokeLink(token: string) {
      if (validSecret(token))
        await pool.query(
          "UPDATE app.customer_login_links SET consumed_at=now() WHERE token_hash=$1",
          [digest(token)],
        );
    },
    async purgeExpired() {
      await pool.query(
        "DELETE FROM app.customer_sessions WHERE expires_at<now(); DELETE FROM app.customer_login_links WHERE expires_at<now()-interval '1 day'",
      );
    },
    close: () => pool.end(),
  };
}
