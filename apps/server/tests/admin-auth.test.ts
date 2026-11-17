import { createMemoryAdminAccountStore } from "@checkdrop/db";
import { describe, expect, it } from "vitest";
import { hashAdminPassword, verifyAdminPassword } from "../src/admin-auth.js";
import { createApp } from "../src/app.js";

const origin = "https://checks.example.com";
const setupCode = "setup-code-1234567890";
const password = "correct horse battery staple";

function instance(mode: "password" | "external" = "password") {
  const store = createMemoryAdminAccountStore();
  let clock = new Date("2026-11-12T10:00:00.000Z");
  const app = createApp({
    pilotStore: null,
    shadowObservationStore: null,
    integrationStore: null,
    checkoutEventStore: null,
    addressSearcher: null,
    adminAccountStore: store,
    adminSetupCode: setupCode,
    instanceConfig: { publicApiUrl: origin, publicAdminUrl: origin, adminAuthMode: mode },
    now: () => clock,
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, ...headers },
      body: JSON.stringify(body),
    });
  const cookieOf = (response: Response) => response.headers.get("Set-Cookie")?.split(";")[0] ?? "";
  const verify = (uri: string, cookie = "") =>
    app.request("/v1/admin/auth/verify", {
      headers: { "X-Forwarded-Uri": uri, ...(cookie ? { Cookie: cookie } : {}) },
    });
  const setup = (overrides: Record<string, unknown> = {}) =>
    post("/v1/admin/auth/setup", {
      setup_code: setupCode,
      email: " Admin@Example.com ",
      password,
      ...overrides,
    });
  return {
    app,
    store,
    post,
    cookieOf,
    verify,
    setup,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe("administrator sign-in", () => {
  it("creates the first account only with the one-time setup code", async () => {
    const t = instance();
    const status = await t.app.request("/v1/admin/auth/status");
    await expect(status.json()).resolves.toMatchObject({
      mode: "password",
      setup_required: true,
      signed_in: false,
    });

    expect((await t.setup({ setup_code: "wrong" })).status).toBe(401);
    expect((await t.setup({ password: "short" })).status).toBe(400);
    const created = await t.setup();
    expect(created.status).toBe(201);
    const cookie = created.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^checkdrop_admin_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(t.store.users).toHaveLength(1);
    expect(t.store.users[0]?.email).toBe("admin@example.com");
    expect(t.store.users[0]?.passwordHash).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(JSON.stringify(t.store.users)).not.toContain(password);

    expect((await t.setup({ email: "second@example.com" })).status).toBe(409);
    expect(t.store.users).toHaveLength(1);
  });

  it("lets the web server through only with a valid session", async () => {
    const t = instance();
    const cookie = t.cookieOf(await t.setup());

    for (const page of ["/", "/dashboard", "/monitor?site=a", "/integrations", "/playground"]) {
      const anonymous = await t.verify(page);
      expect(anonymous.status).toBe(302);
      expect(anonymous.headers.get("Location")).toBe(
        `/sign-in?next=${encodeURIComponent(page.split("?")[0] ?? "/")}`,
      );
      expect((await t.verify(page, cookie)).status).toBe(204);
    }
    const api = await t.verify("/checkdrop/v1/operator/integrations");
    expect(api.status).toBe(401);
    expect((await t.verify("/checkdrop/v1/operator/integrations", cookie)).status).toBe(204);
    expect((await t.verify("//evil.example/x")).headers.get("Location")).toBe("/sign-in?next=%2F");

    const signedOut = await t.post("/v1/admin/auth/sign-out", {}, { Cookie: cookie });
    expect(signedOut.status).toBe(204);
    expect((await t.verify("/monitor", cookie)).status).toBe(302);
  });

  it("ends the session after twelve hours", async () => {
    const t = instance();
    const cookie = t.cookieOf(await t.setup());
    t.advance(12 * 60 * 60 * 1000 - 1);
    expect((await t.verify("/monitor", cookie)).status).toBe(204);
    t.advance(2);
    expect((await t.verify("/monitor", cookie)).status).toBe(302);
  });

  it("answers wrong passwords and unknown accounts the same way", async () => {
    const t = instance();
    await t.setup();
    const wrong = await t.post("/v1/admin/auth/sign-in", {
      email: "admin@example.com",
      password: "not the password",
    });
    const unknown = await t.post("/v1/admin/auth/sign-in", {
      email: "nobody@example.com",
      password: "not the password",
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());

    const ok = await t.post("/v1/admin/auth/sign-in", { email: "ADMIN@example.com", password });
    expect(ok.status).toBe(200);
    expect(t.cookieOf(ok)).toMatch(/^checkdrop_admin_session=/);
  });

  it("refuses the sixth failed attempt in a minute even with the right password", async () => {
    const t = instance();
    await t.setup();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await t.post("/v1/admin/auth/sign-in", {
        email: "admin@example.com",
        password: `guess ${attempt} xxxxxxxx`,
      });
      expect(response.status).toBe(401);
    }
    const blocked = await t.post("/v1/admin/auth/sign-in", {
      email: "admin@example.com",
      password,
    });
    expect(blocked.status).toBe(429);
    t.advance(60_001);
    expect(
      (await t.post("/v1/admin/auth/sign-in", { email: "admin@example.com", password })).status,
    ).toBe(200);
  });

  it("refuses requests from other origins and non-JSON forms", async () => {
    const t = instance();
    expect((await t.setup()).status).toBe(201);
    const foreign = await t.post(
      "/v1/admin/auth/sign-in",
      { email: "admin@example.com", password },
      { Origin: "https://attacker.example" },
    );
    expect(foreign.status).toBe(403);
    const form = await t.app.request("/v1/admin/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: "email=admin%40example.com",
    });
    expect(form.status).toBe(415);
  });

  it("does not offer setup without a configured code", async () => {
    const store = createMemoryAdminAccountStore();
    const app = createApp({
      pilotStore: null,
      adminAccountStore: store,
      adminSetupCode: null,
      instanceConfig: { publicApiUrl: origin, publicAdminUrl: origin, adminAuthMode: "password" },
    });
    const response = await app.request("/v1/admin/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ setup_code: "", email: "a@example.com", password }),
    });
    expect(response.status).toBe(403);
    expect(store.users).toHaveLength(0);
  });

  it("ends every session when the password is reset", async () => {
    const t = instance();
    const cookie = t.cookieOf(await t.setup());
    expect(await t.store.setPassword("admin@example.com", await hashAdminPassword("x".repeat(16))));
    expect((await t.verify("/monitor", cookie)).status).toBe(302);
  });

  it("has no sign-in routes in external mode", async () => {
    const t = instance("external");
    expect((await t.app.request("/v1/admin/auth/status")).status).toBe(404);
    expect((await t.verify("/monitor")).status).toBe(404);
  });

  it("verifies only the exact password", async () => {
    const hash = await hashAdminPassword(password);
    expect(await verifyAdminPassword(password, hash)).toBe(true);
    expect(await verifyAdminPassword(`${password} `, hash)).toBe(false);
    expect(await verifyAdminPassword(password, "plain")).toBe(false);
  });

  it("counts parallel guesses before checking them", async () => {
    const t = instance();
    await t.setup();
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, attempt) =>
        t.post("/v1/admin/auth/sign-in", {
          email: "admin@example.com",
          password: `parallel guess ${attempt}`,
        }),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(7);
  });

  it("does not let another client lock the administrator out", async () => {
    const t = instance();
    await t.setup();
    for (let attempt = 0; attempt < 5; attempt += 1)
      await t.post(
        "/v1/admin/auth/sign-in",
        { email: "admin@example.com", password: `guess ${attempt} xxxxxxxx` },
        { "X-Forwarded-For": "203.0.113.9" },
      );
    const owner = await t.post(
      "/v1/admin/auth/sign-in",
      { email: "admin@example.com", password },
      { "X-Forwarded-For": "198.51.100.4" },
    );
    expect(owner.status).toBe(200);
  });

  it("refuses an oversized request body without reading it", async () => {
    const t = instance();
    const response = await t.post("/v1/admin/auth/sign-in", {
      email: "admin@example.com",
      password: "x".repeat(10_000),
    });
    expect(response.status).toBe(401);
    expect(t.store.users).toHaveLength(0);
  });
});
