export const providerHealthStates = [
  "available",
  "degraded",
  "unavailable",
  "not_checked",
] as const;

export type ProviderHealth = (typeof providerHealthStates)[number];

export const providerLookupStates = [
  "confirmed",
  "not_found",
  "invalid_input",
  "unavailable",
  "invalid_response",
] as const;

export type ProviderLookupState = (typeof providerLookupStates)[number];

/**
 * Stable, redacted evidence about one external-source lookup.
 * `detail` is an application-owned code, never a raw provider response or exception message.
 */
export interface ProviderEvidence {
  readonly source: string;
  readonly checked_at: string;
  readonly state: ProviderLookupState;
  readonly health: ProviderHealth;
  readonly http_status?: number;
  readonly detail?: string;
}
