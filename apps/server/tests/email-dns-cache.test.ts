import type { DnsLookupResult } from "@checkdrop/core";
import { describe, expect, it, vi } from "vitest";
import { createCachedEmailDnsLookup } from "../src/email-dns-cache.js";

const resolved = {
  state: "resolved",
  hasMx: true,
  hasAddress: false,
  checkedAt: "2026-09-19T10:00:00Z",
} as const satisfies DnsLookupResult;
const notFound = {
  state: "not_found",
  hasMx: false,
  hasAddress: false,
  checkedAt: "2026-09-19T10:00:00Z",
} as const satisfies DnsLookupResult;
const unavailable = {
  state: "unavailable",
  hasMx: false,
  hasAddress: false,
  checkedAt: "2026-09-19T10:00:00Z",
} as const satisfies DnsLookupResult;

function controlledLookup() {
  const releases: ((value: DnsLookupResult) => void)[] = [];
  const lookup = vi.fn(
    () =>
      new Promise<DnsLookupResult>((resolve) => {
        releases.push(resolve);
      }),
  );
  return { lookup, release: (value: DnsLookupResult) => releases.shift()?.(value) };
}

describe("bounded e-mail DNS cache", () => {
  it("shares one lookup between concurrent requests and keeps a resolved domain 15 min", async () => {
    const { lookup, release } = controlledLookup();
    let now = 0;
    const cached = createCachedEmailDnsLookup(lookup, { now: () => now });
    const requests = Array.from({ length: 20 }, () => cached("gmail.com"));
    await Promise.resolve();
    expect(lookup).toHaveBeenCalledTimes(1);
    release(resolved);
    expect(await Promise.all(requests)).toEqual(Array(20).fill(resolved));
    await cached("GMAIL.COM ");
    expect(lookup).toHaveBeenCalledTimes(1);
    now = 15 * 60_000 - 1;
    await cached("gmail.com");
    expect(lookup).toHaveBeenCalledTimes(1);
    now = 15 * 60_000 + 1;
    const expired = cached("gmail.com");
    await Promise.resolve();
    expect(lookup).toHaveBeenCalledTimes(2);
    release(resolved);
    await expired;
  });

  it("keeps the original checkedAt and returns an independent copy", async () => {
    const cached = createCachedEmailDnsLookup(async () => ({ ...resolved }));
    const first = await cached("seznam.cz");
    (first as { hasMx: boolean }).hasMx = false;
    const second = await cached("seznam.cz");
    expect(second).toEqual(resolved);
    expect(second.checkedAt).toBe("2026-09-19T10:00:00Z");
  });

  it("keeps not_found for 5 s only", async () => {
    let now = 0;
    const lookup = vi.fn(async () => notFound);
    const cached = createCachedEmailDnsLookup(lookup, { now: () => now });
    await cached("neexistuje.cz");
    now = 4_999;
    await cached("neexistuje.cz");
    expect(lookup).toHaveBeenCalledTimes(1);
    now = 5_001;
    await cached("neexistuje.cz");
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("never stores unavailable answers or thrown errors", async () => {
    const lookup = vi
      .fn<(domain: string) => Promise<DnsLookupResult>>()
      .mockResolvedValueOnce(unavailable)
      .mockRejectedValueOnce(new Error("resolver crashed"))
      .mockResolvedValueOnce(resolved);
    const cached = createCachedEmailDnsLookup(lookup);
    expect(await cached("example.cz")).toEqual(unavailable);
    await expect(cached("example.cz")).rejects.toThrow("resolver crashed");
    expect(await cached("example.cz")).toEqual(resolved);
    expect(await cached("example.cz")).toEqual(resolved);
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("keeps different domains apart and evicts the least recently used entry", async () => {
    const lookup = vi.fn(async () => resolved);
    const cached = createCachedEmailDnsLookup(lookup, { maxEntries: 2 });
    await cached("a.cz");
    await cached("b.cz");
    await cached("a.cz");
    await cached("c.cz");
    expect(lookup).toHaveBeenCalledTimes(3);
    await cached("a.cz");
    expect(lookup).toHaveBeenCalledTimes(3);
    await cached("b.cz");
    expect(lookup).toHaveBeenCalledTimes(4);
  });

  it("answers unavailable instead of queueing when too many lookups are in flight", async () => {
    const { lookup, release } = controlledLookup();
    const cached = createCachedEmailDnsLookup(lookup, { maxInFlight: 1 });
    const first = cached("a.cz");
    const overflow = await cached("b.cz");
    expect(overflow.state).toBe("unavailable");
    expect(lookup).toHaveBeenCalledTimes(1);
    release(resolved);
    await first;
  });
});
