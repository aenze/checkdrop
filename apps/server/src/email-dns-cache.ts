import type { DnsLookupResult } from "@checkdrop/core";
import { createLiveLookup } from "./providers/live-lookup.js";

export interface CachedEmailDnsLookupOptions {
  readonly now?: () => number;
  /** Lifetime of a resolved domain, counted from the end of the real lookup. */
  readonly positiveTtlMs?: number;
  /** Lifetime of a confirmed not_found answer. */
  readonly negativeTtlMs?: number;
  readonly maxEntries?: number;
  readonly maxInFlight?: number;
}

type DnsLookup = (domain: string) => Promise<DnsLookupResult>;

/**
 * Bounded in-process cache for e-mail domain DNS lookups.
 *
 * Concurrent requests for one domain share a single lookup. Only resolved and not_found answers
 * are kept; unavailable answers and thrown errors are never cached. The cache holds domain names
 * only, never local parts or complete e-mail addresses. Each caller receives its own copy.
 */
export function createCachedEmailDnsLookup(
  lookup: DnsLookup,
  options: CachedEmailDnsLookupOptions = {},
): DnsLookup {
  // MX and address records of a mail domain rarely change; a typo domain is still re-checked soon.
  const positiveTtlMs = options.positiveTtlMs ?? 15 * 60_000;
  const negativeTtlMs = options.negativeTtlMs ?? 5_000;
  const cached = createLiveLookup(lookup, (domain: string) => domain, {
    ...(options.now ? { now: options.now } : {}),
    ttlMs: (result) =>
      result.state === "resolved"
        ? positiveTtlMs
        : result.state === "not_found"
          ? negativeTtlMs
          : 0,
    maxEntries: options.maxEntries ?? 2_048,
    maxInFlight: options.maxInFlight ?? 128,
    whenBusy: (): DnsLookupResult => ({
      state: "unavailable",
      hasMx: false,
      hasAddress: false,
      checkedAt: new Date().toISOString(),
      detail: "DNS lookup capacity is temporarily exhausted.",
    }),
    copy: (result) => ({ ...result }),
  });
  return (domain) => cached(domain.trim().toLowerCase());
}
