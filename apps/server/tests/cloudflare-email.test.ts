import { describe, expect, it, vi } from "vitest";
import { createCloudflareLoginEmail } from "../src/cloudflare-email.js";

const options = {
  accountId: "a".repeat(32),
  apiToken: "test-token",
  from: "support@checkdrop.dev",
  loginOrigin: "https://app.checkdrop.dev",
};
const link = `https://app.checkdrop.dev/login/confirm#token=${"a".repeat(43)}`;
describe("Cloudflare transactional login email", () => {
  it("uses the documented Sending API and accepts a queued recipient", async () => {
    const send = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ success: true, result: { queued: ["user@example.test"], delivered: [] } }),
    );
    await createCloudflareLoginEmail({ ...options, fetch: send }).sendLogin(
      "user@example.test",
      link,
    );
    expect(send).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/email/sending/send`,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
    const body = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
    expect(body.to).toBe("user@example.test");
    expect(body.text).toContain(link);
    expect(body.text).toContain("15 minut");
  });
  it.each([
    { success: false },
    { success: true, result: { permanent_bounces: ["user@example.test"] } },
    { success: true, result: { suppressed_recipients: ["user@example.test"] } },
  ])("does not misreport rejected mail as sent", async (body) => {
    await expect(
      createCloudflareLoginEmail({ ...options, fetch: async () => Response.json(body) }).sendLogin(
        "user@example.test",
        link,
      ),
    ).rejects.toThrow();
  });
  it("rejects external redirect links before making any network request", async () => {
    const send = vi.fn();
    await expect(
      createCloudflareLoginEmail({ ...options, fetch: send }).sendLogin(
        "user@example.test",
        `https://attacker.test/login/confirm#token=${"a".repeat(43)}`,
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("does not include provider response text in errors", async () => {
    await expect(
      createCloudflareLoginEmail({
        ...options,
        fetch: async () => new Response("private recipient details", { status: 403 }),
      }).sendLogin("user@example.test", link),
    ).rejects.toThrow("Cloudflare login email unavailable");
  });
});
