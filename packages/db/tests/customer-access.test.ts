import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomerAccessStore, customerRoleAllows } from "../src/customer-access.js";

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({
  Pool: class {
    query = database.query;
    end = database.end;
  },
}));

describe("customer permissions are deny-by-default", () => {
  it.each([
    ["owner", "read", true],
    ["owner", "configure", true],
    ["owner", "manage_members", true],
    ["admin", "read", true],
    ["admin", "configure", true],
    ["admin", "manage_members", false],
    ["viewer", "read", true],
    ["viewer", "configure", false],
    ["viewer", "manage_members", false],
    ["unknown", "read", false],
    ["owner", "unknown", false],
    ["", "read", false],
  ])("%s / %s = %s", (role, permission, allowed) => {
    expect(customerRoleAllows(String(role), String(permission))).toBe(allowed);
  });
});

describe("customer access store contract (mock database)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  const identity = { issuer: "https://identity.example", subject: "user-1" };

  it("passes issuer, subject and project separately as SQL parameters", async () => {
    database.query.mockResolvedValue({ rows: [{ organization_id: "org-1", role: "viewer" }] });
    const store = createCustomerAccessStore("postgres://unused");
    expect(await store.authorize(identity, "project-1", "read")).toEqual({
      organizationId: "org-1",
      projectRef: "project-1",
      role: "viewer",
    });
    expect(database.query).toHaveBeenCalledWith(expect.any(String), [
      identity.issuer,
      identity.subject,
      "project-1",
    ]);
  });

  it("denies a missing membership or project", async () => {
    database.query.mockResolvedValue({ rows: [] });
    expect(
      await createCustomerAccessStore("postgres://unused").authorize(
        identity,
        "other-project",
        "read",
      ),
    ).toBeNull();
  });

  it("denies writes to a viewer even when a membership is returned", async () => {
    database.query.mockResolvedValue({ rows: [{ organization_id: "org-1", role: "viewer" }] });
    expect(
      await createCustomerAccessStore("postgres://unused").authorize(
        identity,
        "project-1",
        "configure",
      ),
    ).toBeNull();
  });

  it("does not query with an absent identity", async () => {
    expect(
      await createCustomerAccessStore("postgres://unused").authorize(
        { issuer: "", subject: "" },
        "project-1",
        "read",
      ),
    ).toBeNull();
    expect(database.query).not.toHaveBeenCalled();
  });

  it("propagates database errors without granting access", async () => {
    database.query.mockRejectedValue(new Error("database unavailable"));
    await expect(
      createCustomerAccessStore("postgres://unused").authorize(identity, "project-1", "read"),
    ).rejects.toThrow("database unavailable");
  });
});
