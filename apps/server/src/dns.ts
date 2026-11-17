import { Resolver } from "node:dns/promises";
import type { DnsLookupResult } from "@checkdrop/core";

const DEFAULT_DNS_TIMEOUT_MS = 2_000;

interface EmailDnsResolver {
  resolveMx(domain: string): Promise<readonly unknown[]>;
  resolve4(domain: string): Promise<readonly unknown[]>;
  cancel(): void;
}

export interface EmailDnsLookupOptions {
  readonly timeoutMs?: number;
  readonly resolver?: EmailDnsResolver;
}

export async function lookupEmailDns(
  domain: string,
  options: EmailDnsLookupOptions = {},
): Promise<DnsLookupResult> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("DNS timeoutMs must be an integer between 1 and 30000.");
  }
  const resolver =
    options.resolver ?? new Resolver({ timeout: Math.min(timeoutMs, 1_000), tries: 1 });
  const lookup = Promise.allSettled([resolver.resolveMx(domain), resolver.resolve4(domain)]);
  const timeout = Symbol("dns-timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    lookup,
    new Promise<typeof timeout>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolver.cancel();
        resolve(timeout);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  });

  if (outcome === timeout) {
    return {
      state: "unavailable",
      hasMx: false,
      hasAddress: false,
      checkedAt,
      detail: "DNS lookup exceeded the validation deadline.",
    };
  }

  const [mx, address] = outcome;
  const hasMx = mx.status === "fulfilled" && mx.value.length > 0;
  const hasAddress = address.status === "fulfilled" && address.value.length > 0;

  if (hasMx || hasAddress) {
    return { state: "resolved", hasMx, hasAddress, checkedAt };
  }

  const bothNotFound = [mx, address].every(
    (entry) => entry.status === "rejected" && isNotFoundCode(entry.reason),
  );
  return {
    state: bothNotFound ? "not_found" : "unavailable",
    hasMx: false,
    hasAddress: false,
    checkedAt,
    ...(!bothNotFound ? { detail: "DNS lookup failed within the validation boundary." } : {}),
  };
}

function isNotFoundCode(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "ENOTFOUND" || error.code === "ENODATA";
}
