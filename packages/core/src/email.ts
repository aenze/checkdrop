import { findEmailDomainCandidate, parseEmailForSuggestion } from "./email-suggestion.js";
import type { RecommendedAction, ValidationPolicy, ValidationStatus } from "./index.js";
import { resolveRecommendedAction } from "./index.js";

export type EmailIssueCode =
  | "email.syntax_invalid"
  | "email.domain_invalid"
  | "email.domain_typo"
  | "email.domain_no_dns"
  | "email.domain_no_mx"
  | "email.domain_disposable"
  | "email.local_role";

export interface EmailIssue {
  readonly code: EmailIssueCode;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
}

export interface DnsLookupResult {
  readonly state: "resolved" | "not_found" | "unavailable";
  readonly hasMx: boolean;
  readonly hasAddress: boolean;
  readonly checkedAt: string;
  readonly detail?: string;
}

export interface EmailEvidence {
  readonly source: "syntax" | "dns" | "domain_metadata" | "local_part";
  readonly checked_at: string;
  readonly state: "confirmed" | "absent" | "unavailable" | "stale" | "not_applicable";
  readonly detail?: string;
}

export interface EmailValidationResult {
  readonly status: ValidationStatus;
  readonly recommended_action: RecommendedAction;
  readonly normalized: string | null;
  readonly suggestion: string | null;
  readonly issues: readonly EmailIssue[];
  readonly evidence: readonly EmailEvidence[];
}

export interface EmailValidationOptions {
  readonly policy?: Exclude<ValidationPolicy, "custom">;
  readonly allowBlocking?: boolean;
  readonly now?: () => Date;
  readonly lookupDns: (domain: string) => Promise<DnsLookupResult>;
  readonly rules?: EmailRules;
  /** One deadline for the whole DNS phase of a validation, default 2 000 ms. */
  readonly dnsBudgetMs?: number;
}

export interface EmailRules {
  readonly domainCorrections: Readonly<Record<string, string>>;
  readonly disposableDomains: ReadonlySet<string>;
  readonly roleLocalParts: ReadonlySet<string>;
  /** Known mailbox providers used for one-edit guesses; not a list of accepted domains. */
  readonly providerDomains?: readonly string[];
  /** Small reviewed subset of corrections that the hosted script may offer before any request. */
  readonly instantCorrections?: Readonly<Record<string, string>>;
}

const emptyEmailRules: EmailRules = {
  domainCorrections: {},
  disposableDomains: new Set(),
  roleLocalParts: new Set(),
};

type DnsOutcome = { readonly original: DnsLookupResult; readonly target: DnsLookupResult | null };

function usable(dns: DnsLookupResult): boolean {
  return dns.state === "resolved" && (dns.hasMx || dns.hasAddress);
}

function unavailableDns(checkedAt: string, detail: string): DnsLookupResult {
  return { state: "unavailable", hasMx: false, hasAddress: false, checkedAt, detail };
}

/**
 * Looks up at most two domain names within one shared deadline. Explicit catalogue corrections query
 * both names at once; a guessed provider is only queried after the typed domain is confirmed not to
 * exist.
 */
async function lookupWithBudget(
  domain: string,
  explicitTarget: string | null,
  guessTarget: (() => string | null) | null,
  lookupDns: (domain: string) => Promise<DnsLookupResult>,
  budgetMs: number,
  checkedAt: string,
): Promise<DnsOutcome & { readonly target_domain: string | null }> {
  const safeLookup = (name: string) =>
    lookupDns(name).catch(() => unavailableDns(checkedAt, "DNS lookup failed."));
  const work = (async () => {
    if (explicitTarget) {
      const [original, target] = await Promise.all([
        safeLookup(domain),
        safeLookup(explicitTarget),
      ]);
      return { original, target, target_domain: explicitTarget };
    }
    const original = await safeLookup(domain);
    const guessed = original.state === "not_found" && guessTarget ? guessTarget() : null;
    if (!guessed) return { original, target: null, target_domain: null };
    return { original, target: await safeLookup(guessed), target_domain: guessed };
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<DnsOutcome & { readonly target_domain: string | null }>(
    (resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            original: unavailableDns(checkedAt, "DNS lookup exceeded the validation deadline."),
            target: null,
            target_domain: null,
          }),
        budgetMs,
      );
    },
  );
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function validateEmail(
  rawInput: string,
  {
    lookupDns,
    policy = "assist",
    allowBlocking = false,
    now = () => new Date(),
    rules = emptyEmailRules,
    dnsBudgetMs = 2_000,
  }: EmailValidationOptions,
): Promise<EmailValidationResult> {
  const checkedAt = now().toISOString();
  const parts = parseEmailForSuggestion(rawInput);

  if (!parts) {
    return result(
      "invalid",
      null,
      null,
      [{ code: "email.syntax_invalid", severity: "error", message: "Email syntax is invalid." }],
      [{ source: "syntax", checked_at: checkedAt, state: "absent" }],
      policy,
      allowBlocking,
    );
  }

  const { local, domain } = parts;
  const normalized = `${local}@${domain}`;
  const issues: EmailIssue[] = [];
  const evidence: EmailEvidence[] = [
    { source: "syntax", checked_at: checkedAt, state: "confirmed" },
  ];

  if (rules.disposableDomains.has(domain)) {
    issues.push({
      code: "email.domain_disposable",
      severity: "warning",
      message: "The domain is associated with temporary email addresses.",
    });
  }

  if (rules.roleLocalParts.has(local.toLowerCase())) {
    issues.push({
      code: "email.local_role",
      severity: "warning",
      message: "The local part represents a shared role rather than a person.",
    });
  }

  evidence.push({
    source: "domain_metadata",
    checked_at: checkedAt,
    state: rules.disposableDomains.has(domain) ? "confirmed" : "absent",
  });
  evidence.push({
    source: "local_part",
    checked_at: checkedAt,
    state: rules.roleLocalParts.has(local.toLowerCase()) ? "confirmed" : "absent",
  });

  const explicit = rules.domainCorrections[domain];
  const explicitTarget = explicit && explicit !== domain ? explicit : null;
  const providers = rules.providerDomains ?? [];
  const dns = await lookupWithBudget(
    domain,
    explicitTarget,
    providers.length > 0 ? () => findEmailDomainCandidate(domain, providers) : null,
    lookupDns,
    Math.max(1, dnsBudgetMs),
    checkedAt,
  );
  const original = dns.original;
  evidence.push({
    source: "dns",
    checked_at: original.checkedAt,
    state:
      original.state === "unavailable"
        ? "unavailable"
        : original.state === "resolved"
          ? "confirmed"
          : "absent",
    ...(original.detail ? { detail: original.detail } : {}),
  });

  const target = dns.target;
  const targetHasMx = Boolean(dns.target_domain && target?.state === "resolved" && target.hasMx);
  // Reviewed catalogue typos are proposed even when the typed domain resolves: most of them are
  // registered by typosquatters (for example gamil.com and seznan.cz accept mail). The customer
  // still decides. Guesses outside the catalogue never override a typed domain that exists.
  if (explicitTarget && targetHasMx) {
    issues.push({
      code: "email.domain_typo",
      severity: "warning",
      message: `The domain resembles ${explicitTarget}.`,
    });
    return result(
      "correctable",
      normalized,
      `${local}@${explicitTarget}`,
      issues,
      evidence,
      policy,
      allowBlocking,
    );
  }

  if (original.state === "unavailable" || (explicitTarget && target?.state === "unavailable")) {
    return result("unknown", normalized, null, issues, evidence, policy, allowBlocking);
  }

  if (!usable(original)) {
    if (targetHasMx) {
      issues.push({
        code: "email.domain_typo",
        severity: "warning",
        message: `The domain resembles ${dns.target_domain}.`,
      });
      return result(
        "correctable",
        normalized,
        `${local}@${dns.target_domain}`,
        issues,
        evidence,
        policy,
        allowBlocking,
      );
    }
    issues.push({
      code: "email.domain_no_dns",
      severity: "error",
      message: "The domain has no usable DNS records.",
    });
    return result("invalid", normalized, null, issues, evidence, policy, allowBlocking);
  }

  if (!original.hasMx) {
    issues.push({
      code: "email.domain_no_mx",
      severity: "warning",
      message: "The domain has no MX record and relies on address-record fallback.",
    });
  }

  const status: ValidationStatus = issues.some((issue) => issue.severity === "warning")
    ? "risky"
    : "valid";

  return result(status, normalized, null, issues, evidence, policy, allowBlocking);
}

function result(
  status: ValidationStatus,
  normalized: string | null,
  suggestion: string | null,
  issues: readonly EmailIssue[],
  evidence: readonly EmailEvidence[],
  policy: Exclude<ValidationPolicy, "custom">,
  allowBlocking: boolean,
): EmailValidationResult {
  return {
    status,
    recommended_action: resolveRecommendedAction({ status, policy, allowBlocking }),
    normalized,
    suggestion,
    issues,
    evidence,
  };
}
