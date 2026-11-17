import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { AdminAccountStore } from "@checkdrop/db";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const ADMIN_SESSION_COOKIE = "checkdrop_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 256;
const WINDOW_MS = 60_000;
const FAILURES_PER_ACCOUNT = 5;
const ATTEMPTS_PER_CLIENT = 20;
/** Across all clients, so a distributed guess stays slow without letting one client lock it. */
const FAILURES_PER_ACCOUNT_TOTAL = 50;
const MAX_BODY_BYTES = 4_096;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 } as const;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT.keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** scrypt$<log2 N>$<r>$<p>$<salt>$<hash>, both base64url. */
export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return [
    "scrypt",
    Math.log2(SCRYPT.N),
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyAdminPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, logN, r, p, salt, hash] = stored.split("$");
  if (
    scheme !== "scrypt" ||
    Number(logN) !== Math.log2(SCRYPT.N) ||
    Number(r) !== SCRYPT.r ||
    Number(p) !== SCRYPT.p ||
    !salt ||
    !hash
  )
    return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function adminPasswordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "password_required";
  if ([...password].length < PASSWORD_MIN) return "password_too_short";
  if (password.length > PASSWORD_MAX) return "password_too_long";
  return null;
}

export function normalizeAdminEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

/** Counts per key inside a fixed window; process-local, which suits one server per installation. */
function windowCounter(limit: number) {
  const entries = new Map<string, { count: number; resetAt: number }>();
  return {
    blocked(key: string, now: number) {
      const entry = entries.get(key);
      return Boolean(entry && entry.resetAt > now && entry.count >= limit);
    },
    add(key: string, now: number) {
      const entry = entries.get(key);
      if (!entry || entry.resetAt <= now) entries.set(key, { count: 1, resetAt: now + WINDOW_MS });
      else entry.count += 1;
      if (entries.size > 10_000) {
        for (const [candidate, value] of entries)
          if (value.resetAt <= now) entries.delete(candidate);
      }
    },
    clear(key: string) {
      entries.delete(key);
    },
  };
}

export interface AdminAuthOptions {
  readonly store: AdminAccountStore;
  /** Origin of the administration; state-changing requests must come from it. */
  readonly adminOrigin: string;
  /** One-time code printed by the installer; it only works while no account exists. */
  readonly setupCode: string | null;
  readonly now?: () => Date;
}

/**
 * Checkdrop's own administrator sign-in. The web server asks /v1/admin/auth/verify before every
 * administration page and admin API request; nothing else in the administration is reachable
 * without a valid session.
 */
export function registerAdminAuthRoutes(app: Hono, options: AdminAuthOptions) {
  const now = options.now ?? (() => new Date());
  const accountFailures = windowCounter(FAILURES_PER_ACCOUNT);
  const accountFailuresTotal = windowCounter(FAILURES_PER_ACCOUNT_TOTAL);
  const clientAttempts = windowCounter(ATTEMPTS_PER_CLIENT);
  const secure = options.adminOrigin.startsWith("https://");
  // Unknown accounts still cost one scrypt run, so timing does not reveal which e-mails exist.
  const dummyHash = hashAdminPassword(randomBytes(24).toString("base64url"));
  const setupDigest = options.setupCode?.trim()
    ? createHash("sha256").update(options.setupCode.trim()).digest()
    : null;

  const fail = (context: Context, status: 400 | 401 | 403 | 409 | 415 | 429, code: string) =>
    context.json({ error: code }, status, { "Cache-Control": "no-store" });

  const clientKey = (context: Context) =>
    context.req.header("X-Forwarded-For")?.split(",")[0]?.trim() || "direct";

  async function readSession(context: Context) {
    const token = getCookie(context, ADMIN_SESSION_COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return options.store.findSession(digest(token), now());
  }

  async function startSession(context: Context, userId: string) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now().getTime() + SESSION_TTL_MS);
    await options.store.createSession(digest(token), userId, expiresAt);
    await options.store.recordSignIn(userId, now());
    setCookie(context, ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
  }

  /** Same-origin JSON only; blocks cross-site form posts and other origins. */
  function rejectForeign(context: Context) {
    if (!context.req.header("Content-Type")?.toLowerCase().startsWith("application/json"))
      return fail(context, 415, "json_required");
    if (context.req.header("Origin") !== options.adminOrigin)
      return fail(context, 403, "origin_not_allowed");
    return null;
  }

  /** At most 4 KiB is read; larger bodies are refused before they are buffered. */
  async function readBody(context: Context): Promise<Record<string, unknown> | null> {
    const declared = Number(context.req.header("Content-Length") ?? "0");
    if (declared > MAX_BODY_BYTES) return null;
    const reader = context.req.raw.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return body && typeof body === "object" && !Array.isArray(body) ? body : null;
    } catch {
      return null;
    }
  }

  app.get("/v1/admin/auth/status", async (context) => {
    const session = await readSession(context);
    const setupRequired = !(await options.store.hasUsers());
    return context.json(
      {
        mode: "password",
        setup_required: setupRequired,
        setup_available: setupRequired && setupDigest !== null,
        signed_in: session !== null,
        email: session?.email ?? null,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  app.post("/v1/admin/auth/setup", async (context) => {
    const foreign = rejectForeign(context);
    if (foreign) return foreign;
    const client = clientKey(context);
    const started = now().getTime();
    if (clientAttempts.blocked(client, started)) return fail(context, 429, "too_many_attempts");
    clientAttempts.add(client, started);
    const body = await readBody(context);
    if (!body) return fail(context, 400, "invalid_request");
    if (!setupDigest) return fail(context, 403, "setup_disabled");
    if (await options.store.hasUsers()) return fail(context, 409, "already_set_up");
    const code = typeof body.setup_code === "string" ? body.setup_code.trim() : "";
    if (!timingSafeEqual(createHash("sha256").update(code).digest(), setupDigest))
      return fail(context, 401, "invalid_setup_code");
    const email = normalizeAdminEmail(body.email);
    if (!email) return fail(context, 400, "invalid_email");
    const problem = adminPasswordProblem(body.password);
    if (problem) return fail(context, 400, problem);
    const user = {
      id: randomUUID(),
      email,
      passwordHash: await hashAdminPassword(body.password as string),
    };
    if (!(await options.store.createFirstUser(user))) return fail(context, 409, "already_set_up");
    clientAttempts.clear(client);
    await startSession(context, user.id);
    return context.json({ status: "signed_in", email }, 201, { "Cache-Control": "no-store" });
  });

  app.post("/v1/admin/auth/sign-in", async (context) => {
    const foreign = rejectForeign(context);
    if (foreign) return foreign;
    const client = clientKey(context);
    const started = now().getTime();
    const body = await readBody(context);
    const email = normalizeAdminEmail(body?.email);
    const accountTotal = `account:${email ?? "invalid"}`;
    // Per account and client, so a stranger who knows the e-mail cannot lock the owner out.
    const account = `${accountTotal}:${client}`;
    // Refused before any password check, so guessing stays cheap for us and slow for them.
    if (
      clientAttempts.blocked(client, started) ||
      accountFailures.blocked(account, started) ||
      accountFailuresTotal.blocked(accountTotal, started)
    )
      return fail(context, 429, "too_many_attempts");
    clientAttempts.add(client, started);
    // Counted before the slow check, so parallel requests cannot all pass the limit.
    accountFailures.add(account, started);
    accountFailuresTotal.add(accountTotal, started);
    const password = typeof body?.password === "string" ? body.password : "";
    const user = email ? await options.store.findUserByEmail(email) : null;
    const valid =
      user && password.length <= PASSWORD_MAX
        ? await verifyAdminPassword(password, user.passwordHash)
        : (await verifyAdminPassword(password.slice(0, PASSWORD_MAX), await dummyHash), false);
    if (!user || !valid) return fail(context, 401, "invalid_credentials");
    accountFailures.clear(account);
    await startSession(context, user.id);
    return context.json({ status: "signed_in", email: user.email }, 200, {
      "Cache-Control": "no-store",
    });
  });

  app.post("/v1/admin/auth/sign-out", async (context) => {
    const foreign = rejectForeign(context);
    if (foreign) return foreign;
    const token = getCookie(context, ADMIN_SESSION_COOKIE);
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token))
      await options.store.deleteSession(digest(token));
    deleteCookie(context, ADMIN_SESSION_COOKIE, { path: "/", secure, httpOnly: true });
    return context.body(null, 204, { "Cache-Control": "no-store" });
  });

  /**
   * Asked by the web server (Caddy forward_auth) before each protected request. 204 lets the
   * request through. Pages are redirected to the sign-in page; API calls get 401.
   */
  app.get("/v1/admin/auth/verify", async (context) => {
    if (await readSession(context)) return context.body(null, 204, { "Cache-Control": "no-store" });
    const original = context.req.header("X-Forwarded-Uri") ?? "/";
    if (original.startsWith("/checkdrop/") || original.startsWith("/v1/"))
      return fail(context, 401, "sign_in_required");
    const path = (original.split("?")[0] ?? "/").replace(/\/index\.html$/, "") || "/";
    const next = path.startsWith("/") && !path.startsWith("//") ? path : "/";
    return context.redirect(`/sign-in?next=${encodeURIComponent(next)}`, 302);
  });
}
