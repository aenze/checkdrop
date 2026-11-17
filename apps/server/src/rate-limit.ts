const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_GLOBAL_AUTH_LIMIT = 600;
const DEFAULT_PREFIX_AUTH_LIMIT = 120;
// One shopper's checkout session; a sessionless request shares one budget per site.
const DEFAULT_EMBED_SESSION_LIMIT = 90;
// Safety ceiling for all sessions of one site together.
const DEFAULT_EMBED_SITE_LIMIT = 3_000;
const MAX_COUNTERS_BEFORE_PRUNE = 10_000;
const DEFAULT_KEY_VALIDATION_LIMIT = 120;
const DEFAULT_KEY_IMPORT_LIMIT = 5;

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/** Separate budgets, so analytics or interaction events never use up a shopper's checks. */
export type EmbedRateLimitBucket = "validation" | "assist" | "checkout";

export interface PilotRateLimiter {
  consumeAuthentication(keyPrefix: string): RateLimitDecision;
  consumeEmbed(
    siteKey: string,
    sessionId: string | null,
    bucket: EmbedRateLimitBucket,
  ): RateLimitDecision;
  consumeValidation(apiKeyId: string): RateLimitDecision;
  consumeImport(apiKeyId: string): RateLimitDecision;
}

export interface PilotRateLimiterOptions {
  readonly now?: () => number;
  readonly windowMs?: number;
  readonly globalAuthenticationLimit?: number;
  readonly prefixAuthenticationLimit?: number;
  readonly embedSessionLimit?: number;
  readonly embedSiteLimit?: number;
  readonly keyValidationLimit?: number;
  readonly keyImportLimit?: number;
}

interface WindowCounter {
  count: number;
  resetAt: number;
}

export function createPilotRateLimiter(options: PilotRateLimiterOptions = {}): PilotRateLimiter {
  const now = options.now ?? Date.now;
  const windowMs = positiveInteger(options.windowMs, DEFAULT_WINDOW_MS, "windowMs");
  const globalAuthenticationLimit = positiveInteger(
    options.globalAuthenticationLimit,
    DEFAULT_GLOBAL_AUTH_LIMIT,
    "globalAuthenticationLimit",
  );
  const prefixAuthenticationLimit = positiveInteger(
    options.prefixAuthenticationLimit,
    DEFAULT_PREFIX_AUTH_LIMIT,
    "prefixAuthenticationLimit",
  );
  const embedSessionLimit = positiveInteger(
    options.embedSessionLimit,
    DEFAULT_EMBED_SESSION_LIMIT,
    "embedSessionLimit",
  );
  const embedSiteLimit = positiveInteger(
    options.embedSiteLimit,
    DEFAULT_EMBED_SITE_LIMIT,
    "embedSiteLimit",
  );
  const keyValidationLimit = positiveInteger(
    options.keyValidationLimit,
    DEFAULT_KEY_VALIDATION_LIMIT,
    "keyValidationLimit",
  );
  const keyImportLimit = positiveInteger(
    options.keyImportLimit,
    DEFAULT_KEY_IMPORT_LIMIT,
    "keyImportLimit",
  );
  const counters = new Map<string, WindowCounter>();
  let nextPruneAt = 0;
  const consume = (key: string, limit: number, timestamp: number): RateLimitDecision => {
    const existing = counters.get(key);
    const counter =
      !existing || timestamp >= existing.resetAt
        ? { count: 0, resetAt: timestamp + windowMs }
        : existing;
    counter.count += 1;
    counters.set(key, counter);

    // Per-session keys can be numerous; expired ones are swept at most once per second.
    if (counters.size > MAX_COUNTERS_BEFORE_PRUNE && timestamp >= nextPruneAt) {
      nextPruneAt = timestamp + 1_000;
      for (const [candidate, value] of counters) {
        if (timestamp >= value.resetAt) counters.delete(candidate);
      }
    }

    return {
      allowed: counter.count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil((counter.resetAt - timestamp) / 1_000)),
    };
  };

  return {
    consumeAuthentication(keyPrefix) {
      const global = consume("auth:global", globalAuthenticationLimit, now());
      if (!global.allowed) return global;
      return consume(`auth:prefix:${keyPrefix}`, prefixAuthenticationLimit, now());
    },
    consumeEmbed(siteKey, sessionId, bucket) {
      const timestamp = now();
      // A session that is over its own budget does not also use up the site ceiling.
      const session = consume(
        `embed:${bucket}:session:${siteKey}:${sessionId ?? ""}`,
        embedSessionLimit,
        timestamp,
      );
      if (!session.allowed) return session;
      return consume(`embed:${bucket}:site:${siteKey}`, embedSiteLimit, timestamp);
    },
    consumeValidation(apiKeyId) {
      return consume(`validation:key:${apiKeyId}`, keyValidationLimit, now());
    },
    consumeImport(apiKeyId) {
      return consume(`import:key:${apiKeyId}`, keyImportLimit, now());
    },
  };
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`Pilot rate limiter ${name} must be a positive integer.`);
  }
  return resolved;
}
