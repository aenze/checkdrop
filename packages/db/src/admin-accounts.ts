import { Pool } from "pg";
import { interactivePoolOptions } from "./interactive-pool.js";

export interface AdminUser {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
}

export interface AdminSession {
  readonly userId: string;
  readonly email: string;
  readonly expiresAt: Date;
}

/**
 * Administrator accounts of one installation. Session tokens and passwords are never stored:
 * only a SHA-256 digest of each session token and a scrypt hash of each password.
 */
export interface AdminAccountStore {
  hasUsers(): Promise<boolean>;
  /** Creates the first account only while none exists; false when another one won the race. */
  createFirstUser(user: AdminUser): Promise<boolean>;
  findUserByEmail(email: string): Promise<AdminUser | null>;
  /** Replaces the password and ends every session of that account; false for an unknown e-mail. */
  setPassword(email: string, passwordHash: string): Promise<boolean>;
  createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<AdminSession | null>;
  deleteSession(tokenHash: string): Promise<void>;
  recordSignIn(userId: string, at: Date): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<number>;
  close(): Promise<void>;
}

export function createAdminAccountStore(connectionString: string): AdminAccountStore {
  const pool = new Pool({ ...interactivePoolOptions, connectionString, max: 3 });
  return {
    async hasUsers() {
      const result = await pool.query("SELECT EXISTS (SELECT 1 FROM app.admin_users) AS present");
      return result.rows[0]?.present === true;
    },
    async createFirstUser(user) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("LOCK TABLE app.admin_users IN EXCLUSIVE MODE");
        const inserted = await client.query(
          `INSERT INTO app.admin_users (id, email, password_hash)
           SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM app.admin_users)`,
          [user.id, user.email, user.passwordHash],
        );
        await client.query("COMMIT");
        return inserted.rowCount === 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async findUserByEmail(email) {
      const result = await pool.query<{ id: string; email: string; password_hash: string }>(
        "SELECT id, email, password_hash FROM app.admin_users WHERE email = $1",
        [email],
      );
      const row = result.rows[0];
      return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : null;
    },
    async setPassword(email, passwordHash) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const updated = await client.query<{ id: string }>(
          `UPDATE app.admin_users SET password_hash = $2, password_changed_at = now()
           WHERE email = $1 RETURNING id`,
          [email, passwordHash],
        );
        const id = updated.rows[0]?.id;
        if (id) await client.query("DELETE FROM app.admin_sessions WHERE user_id = $1", [id]);
        await client.query("COMMIT");
        return Boolean(id);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async createSession(tokenHash, userId, expiresAt) {
      await pool.query(
        "INSERT INTO app.admin_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
        [tokenHash, userId, expiresAt],
      );
    },
    async findSession(tokenHash, now) {
      const result = await pool.query<{ user_id: string; email: string; expires_at: Date }>(
        `SELECT s.user_id, u.email, s.expires_at
         FROM app.admin_sessions s JOIN app.admin_users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > $2`,
        [tokenHash, now],
      );
      const row = result.rows[0];
      return row ? { userId: row.user_id, email: row.email, expiresAt: row.expires_at } : null;
    },
    async deleteSession(tokenHash) {
      await pool.query("DELETE FROM app.admin_sessions WHERE token_hash = $1", [tokenHash]);
    },
    async recordSignIn(userId, at) {
      await pool.query("UPDATE app.admin_users SET last_sign_in_at = $2 WHERE id = $1", [
        userId,
        at,
      ]);
    },
    async deleteExpiredSessions(now) {
      const result = await pool.query("DELETE FROM app.admin_sessions WHERE expires_at <= $1", [
        now,
      ]);
      return result.rowCount ?? 0;
    },
    async close() {
      await pool.end();
    },
  };
}

/** In-process store with the same rules, for tests and local tools. */
export function createMemoryAdminAccountStore(): AdminAccountStore & {
  readonly users: AdminUser[];
  readonly sessions: Map<string, { userId: string; expiresAt: Date }>;
} {
  const users: AdminUser[] = [];
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  return {
    users,
    sessions,
    async hasUsers() {
      return users.length > 0;
    },
    async createFirstUser(user) {
      if (users.length > 0) return false;
      users.push(user);
      return true;
    },
    async findUserByEmail(email) {
      return users.find((user) => user.email === email) ?? null;
    },
    async setPassword(email, passwordHash) {
      const index = users.findIndex((user) => user.email === email);
      const user = users[index];
      if (!user) return false;
      users[index] = { ...user, passwordHash };
      for (const [token, session] of sessions)
        if (session.userId === user.id) sessions.delete(token);
      return true;
    },
    async createSession(tokenHash, userId, expiresAt) {
      sessions.set(tokenHash, { userId, expiresAt });
    },
    async findSession(tokenHash, now) {
      const session = sessions.get(tokenHash);
      const user = session && users.find((candidate) => candidate.id === session.userId);
      return session && user && session.expiresAt > now
        ? { userId: user.id, email: user.email, expiresAt: session.expiresAt }
        : null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async recordSignIn() {},
    async deleteExpiredSessions(now) {
      let removed = 0;
      for (const [token, session] of sessions)
        if (session.expiresAt <= now) {
          sessions.delete(token);
          removed += 1;
        }
      return removed;
    },
    async close() {},
  };
}
