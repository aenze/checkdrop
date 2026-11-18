import { describe, expect, it, vi } from "vitest";
import aresCompany from "../../../fixtures/providers/ares/company-00006947.json" with {
  type: "json",
};
import { lookupAresCompany, searchAresCompanies } from "../src/providers/ares.js";
import type { FetchLike } from "../src/providers/runtime.js";

const fixedNow = () => new Date("2026-08-15T10:30:00.000Z");
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("ARES adapter", () => {
  it("maps a verified company response into stable evidence", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(aresCompany));

    const output = await lookupAresCompany("00006947", { fetchImpl, now: fixedNow });

    expect(output).toMatchObject({
      lookup_state: "confirmed",
      status: "valid",
      recommended_action: "accept",
      company: {
        ico: "00006947",
        name: "Ministerstvo financí",
        vat_id: "CZ00006947",
        address_standardized: true,
        registered_office: {
          city: "Praha",
          postal_code: "11800",
          country: "CZ",
        },
      },
      evidence: [
        {
          source: "ares",
          checked_at: "2026-08-15T10:30:00.000Z",
          state: "confirmed",
          health: "available",
          http_status: 200,
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/ekonomicke-subjekty/00006947");
  });

  it("returns structured company suggestions and never invents a partial IČO search", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({ obchodniJmeno: "Alza", pocet: 5 });
      return jsonResponse({ ekonomickeSubjekty: [aresCompany] });
    });

    const suggestions = await searchAresCompanies("Alza", 5, { fetchImpl, now: fixedNow });
    expect(suggestions).toMatchObject({
      status: "matched",
      companies: [{ ico: "00006947", name: "Ministerstvo financí" }],
    });

    const partialIco = await searchAresCompanies("00006", 5, { fetchImpl, now: fixedNow });
    expect(partialIco).toMatchObject({ status: "no_match", companies: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the company name with single spaces", async () => {
    const output = await lookupAresCompany("28371003", {
      fetchImpl: async () => jsonResponse({ ico: "28371003", obchodniJmeno: "ECOZZ  s.r.o. " }),
      now: fixedNow,
    });
    expect(output.company?.name).toBe("ECOZZ s.r.o.");
  });

  it("does not call ARES for an invalid local IČO", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const output = await lookupAresCompany("123", { fetchImpl, now: fixedNow });

    expect(output).toMatchObject({
      lookup_state: "invalid_input",
      status: "invalid",
      recommended_action: "warn",
      evidence: [{ health: "not_checked" }],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("distinguishes a missing record from provider failure", async () => {
    const output = await lookupAresCompany("00006947", {
      fetchImpl: async () => jsonResponse({}, 404),
      now: fixedNow,
    });
    expect(output).toMatchObject({
      lookup_state: "not_found",
      status: "unknown",
      recommended_action: "fail_open",
      evidence: [{ health: "available", http_status: 404 }],
    });
  });

  it.each([
    [429, "degraded", "provider.rate_limited"],
    [503, "unavailable", "provider.server_error"],
  ])("fails open for HTTP %i", async (status, health, detail) => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}, status));
    const output = await lookupAresCompany("00006947", {
      fetchImpl,
      now: fixedNow,
    });
    expect(output).toMatchObject({
      lookup_state: "unavailable",
      status: "unknown",
      recommended_action: "fail_open",
      evidence: [{ health, detail }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched response without exposing its body", async () => {
    const output = await lookupAresCompany("00006947", {
      fetchImpl: async () => jsonResponse({ ico: "27082440", obchodniJmeno: "Wrong record" }),
      now: fixedNow,
    });
    expect(output).toMatchObject({
      lookup_state: "invalid_response",
      status: "unknown",
      company: null,
      evidence: [{ detail: "provider.invalid_response" }],
    });
    expect(JSON.stringify(output)).not.toContain("Wrong record");
  });

  it("classifies network errors as unavailable", async () => {
    const output = await lookupAresCompany("00006947", {
      fetchImpl: async () => {
        throw new Error("sensitive upstream detail");
      },
      now: fixedNow,
    });
    expect(output.evidence[0]).toMatchObject({
      state: "unavailable",
      health: "unavailable",
      detail: "provider.network_error",
    });
    expect(JSON.stringify(output)).not.toContain("sensitive upstream detail");
  });

  it("times out once and returns only a stable error code", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("upstream timeout details", "AbortError")),
            { once: true },
          );
        }),
    );
    const output = await lookupAresCompany("00006947", {
      fetchImpl,
      now: fixedNow,
      timeoutMs: 1,
    });

    expect(output.evidence[0]).toMatchObject({
      state: "unavailable",
      detail: "provider.timeout",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(output)).not.toContain("upstream timeout details");
  });

  it("keeps the deadline and byte limit active after response headers", async () => {
    let bodyCanceled = false;
    const slowBody = new ReadableStream<Uint8Array>({
      cancel() {
        bodyCanceled = true;
      },
    });
    const timedOut = await lookupAresCompany("00006947", {
      fetchImpl: async () => new Response(slowBody, { status: 200 }),
      now: fixedNow,
      timeoutMs: 5,
    });
    const oversized = await lookupAresCompany("00006947", {
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": "70000", "content-type": "application/json" },
        }),
      now: fixedNow,
    });

    expect(bodyCanceled).toBe(true);
    expect(timedOut).toMatchObject({
      lookup_state: "unavailable",
      recommended_action: "fail_open",
      evidence: [{ detail: "provider.timeout" }],
    });
    expect(oversized).toMatchObject({
      lookup_state: "invalid_response",
      recommended_action: "fail_open",
      evidence: [{ detail: "provider.invalid_response" }],
    });
  });
});
