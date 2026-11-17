import { performance } from "node:perf_hooks";
import { type ValidationStatus, validateEmail } from "@checkdrop/core";
import {
  czEmailRules,
  normalizeCzechAddressSearch,
  validateCzechCompanyId,
  validateCzechPhone,
  validateCzechVatId,
} from "@checkdrop/pack-cz";
import corpusJson from "../fixtures/m0-validation-corpus.json" with { type: "json" };

type Capability = "email" | "phone" | "company_id" | "vat_id" | "address_normalization";
type DnsScenario =
  | "resolved_mx"
  | "resolved_address"
  | "not_found"
  | "unavailable"
  | "not_applicable"
  // The typed domain does not exist; any corrected target resolves with MX.
  | "typo_target_mx";

interface CorpusCase {
  readonly id: string;
  readonly capability: Capability;
  readonly input: string;
  readonly expected_status?: ValidationStatus;
  readonly expected_normalized: string | null;
  readonly expected_issue?: string;
  readonly dns?: DnsScenario;
}

interface ActualResult {
  readonly status?: ValidationStatus;
  readonly normalized: string | null;
  readonly issues: readonly string[];
}

const corpus = corpusJson as {
  readonly schema_version: number;
  readonly corpus_version: string;
  readonly scope: string;
  readonly representative_of: string;
  readonly not_representative_of: string;
  readonly cases: readonly CorpusCase[];
};
const fixedCheckedAt = "2026-08-15T10:00:00.000Z";

async function main(): Promise<void> {
  const durations: number[] = [];
  const failures: Array<{
    readonly id: string;
    readonly expected: object;
    readonly actual: ActualResult;
  }> = [];
  const byCapability = new Map<Capability, { total: number; passed: number }>();

  for (const fixture of corpus.cases) {
    const started = performance.now();
    const actual = await execute(fixture);
    durations.push(performance.now() - started);

    const passed =
      (fixture.expected_status === undefined || actual.status === fixture.expected_status) &&
      actual.normalized === fixture.expected_normalized &&
      (fixture.expected_issue === undefined || actual.issues.includes(fixture.expected_issue));
    const counts = byCapability.get(fixture.capability) ?? { total: 0, passed: 0 };
    counts.total += 1;
    if (passed) counts.passed += 1;
    byCapability.set(fixture.capability, counts);

    if (!passed) {
      failures.push({
        id: fixture.id,
        expected: {
          status: fixture.expected_status ?? null,
          normalized: fixture.expected_normalized,
          issue: fixture.expected_issue ?? null,
        },
        actual,
      });
    }
  }

  durations.sort((left, right) => left - right);
  const percentile = (value: number) => durations[Math.floor((durations.length - 1) * value)] ?? 0;
  const passed = corpus.cases.length - failures.length;
  const output = {
    benchmark: "m0.validation.regression",
    corpus_version: corpus.corpus_version,
    corpus_scope: corpus.scope,
    case_count: corpus.cases.length,
    passed,
    failed: failures.length,
    accuracy: passed / corpus.cases.length,
    latency_scope:
      "single-process fixture execution; email DNS is injected; providers are excluded",
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    p99_ms: percentile(0.99),
    by_capability: Object.fromEntries(
      [...byCapability.entries()].map(([capability, counts]) => [
        capability,
        { ...counts, accuracy: counts.passed / counts.total },
      ]),
    ),
    representative_of: corpus.representative_of,
    not_representative_of: corpus.not_representative_of,
    failures,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

void main();

async function execute(fixture: CorpusCase): Promise<ActualResult> {
  switch (fixture.capability) {
    case "email": {
      const output = await validateEmail(fixture.input, {
        rules: czEmailRules,
        now: () => new Date(fixedCheckedAt),
        lookupDns: async (domain) =>
          fixture.dns === "typo_target_mx"
            ? dnsResult(
                domain === fixture.input.split("@").pop()?.toLowerCase()
                  ? "not_found"
                  : "resolved_mx",
              )
            : dnsResult(fixture.dns ?? "resolved_mx"),
      });
      return {
        status: output.status,
        normalized: output.normalized,
        issues: output.issues.map((issue) => issue.code),
      };
    }
    case "phone": {
      const output = validateCzechPhone(fixture.input);
      return { status: output.status, normalized: output.normalized, issues: output.issues };
    }
    case "company_id": {
      const output = validateCzechCompanyId(fixture.input);
      return { status: output.status, normalized: output.normalized, issues: output.issues };
    }
    case "vat_id": {
      const output = validateCzechVatId(fixture.input);
      return { status: output.status, normalized: output.normalized, issues: output.issues };
    }
    case "address_normalization":
      return {
        normalized: normalizeCzechAddressSearch(fixture.input),
        issues: [],
      };
  }
}

function dnsResult(scenario: DnsScenario) {
  switch (scenario) {
    case "resolved_mx":
      return {
        state: "resolved" as const,
        hasMx: true,
        hasAddress: true,
        checkedAt: fixedCheckedAt,
      };
    case "resolved_address":
      return {
        state: "resolved" as const,
        hasMx: false,
        hasAddress: true,
        checkedAt: fixedCheckedAt,
      };
    case "not_found":
    case "not_applicable":
      return {
        state: "not_found" as const,
        hasMx: false,
        hasAddress: false,
        checkedAt: fixedCheckedAt,
      };
    case "unavailable":
      return {
        state: "unavailable" as const,
        hasMx: false,
        hasAddress: false,
        checkedAt: fixedCheckedAt,
        detail: "fixture.unavailable",
      };
  }
}
