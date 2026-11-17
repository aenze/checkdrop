import { afterEach, describe, expect, it, vi } from "vitest";
import { api, assertOperatorPayload } from "./api.js";

afterEach(() => vi.unstubAllGlobals());
describe("operator transport boundary", () => {
  it("rejects a list masquerading as the selected integration", () => {
    expect(() => assertOperatorPayload("/integrations/a", { data: [] })).toThrow(
      "neplatnou konfiguraci",
    );
    expect(() => assertOperatorPayload("/integrations", { data: [] })).not.toThrow();
  });
  it("retains the server conflict detail and sends the caller's version unchanged", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: "Novější verze" }), { status: 409 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const body = JSON.stringify({ expected_version: 3, fields: [] });
    await expect(api("/integrations/a/forms/b/fields", { method: "PUT", body })).rejects.toThrow(
      "Novější verze",
    );
    expect(fetcher.mock.calls[0]?.[1].body).toBe(body);
  });
  it("composes caller cancellation with a bounded timeout", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const request = api("/integrations", { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
