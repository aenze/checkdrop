import { describe, expect, it, vi } from "vitest";
import { createCustomerAuthorizer } from "../src/customer-authorization.js";

const identity = { issuer: "https://identity.test", subject: "user-a" };
function fixture() {
  const verifyBearer = vi.fn(async () => identity);
  const authorize = vi.fn(async () => ({
    organizationId: "org-a",
    projectRef: "project-a",
    role: "viewer" as const,
  }));
  return {
    verifyBearer,
    authorize,
    check: createCustomerAuthorizer({ verifyBearer, accessStore: { authorize } }),
  };
}
function request(headers: Record<string, string> = {}) {
  return new Request("https://api.test/v1/operator/integrations", { headers });
}
describe("customer request authorization", () => {
  it("uses verified identity and a DB permission decision, not a claimed role", async () => {
    const f = fixture();
    expect(
      await f.check(
        request({
          Authorization: "Bearer token",
          "X-Checkdrop-Project": "project-a",
          "X-Checkdrop-Role": "owner",
        }),
        "configure",
      ),
    ).toEqual({ status: "allowed", projectRef: "project-a" });
    expect(f.verifyBearer).toHaveBeenCalledWith("token");
    expect(f.authorize).toHaveBeenCalledWith(identity, "project-a", "configure");
  });
  it.each(["", "Basic token", "Bearer x y", `Bearer ${"a".repeat(8193)}`])(
    "rejects malformed credentials",
    async (authorization) => {
      const f = fixture();
      expect(await f.check(request({ Authorization: authorization }), "read")).toEqual({
        status: "unauthenticated",
      });
      expect(f.authorize).not.toHaveBeenCalled();
    },
  );
  it("rejects another project even if the store accidentally returns the wrong project", async () => {
    const f = fixture();
    expect(
      await f.check(
        request({ Authorization: "Bearer token", "X-Checkdrop-Project": "project-b" }),
        "read",
      ),
    ).toEqual({ status: "forbidden" });
  });
});
