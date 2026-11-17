import { type DnsLookupResult, validateEmail } from "@checkdrop/core";
import { describe, expect, it } from "vitest";
import corpus from "../../../fixtures/email/suggestion-cases.json" with { type: "json" };
import { czEmailRules } from "../src/index.js";

type State = "resolved_mx" | "resolved_address" | "not_found" | "unavailable";
const at = "2026-09-25T08:00:00.000Z";
const answers: Record<State, DnsLookupResult> = {
  resolved_mx: { state: "resolved", hasMx: true, hasAddress: true, checkedAt: at },
  resolved_address: { state: "resolved", hasMx: false, hasAddress: true, checkedAt: at },
  not_found: { state: "not_found", hasMx: false, hasAddress: false, checkedAt: at },
  unavailable: { state: "unavailable", hasMx: false, hasAddress: false, checkedAt: at },
};

describe("e-mail suggestion corpus", () => {
  it("has at least 200 cases across all categories", () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(200);
  });

  it.each(corpus.cases.map((testCase) => [testCase.category, testCase.input, testCase] as const))(
    "%s: %s",
    async (_category, input, testCase) => {
      const unexpected: string[] = [];
      const output = await validateEmail(input, {
        rules: czEmailRules,
        lookupDns: async (domain) => {
          const state = (testCase.dns as Record<string, State | undefined>)[domain];
          // A lookup the case did not define means the rules asked for something unexpected.
          if (!state) unexpected.push(domain);
          return answers[state ?? "unavailable"];
        },
      });
      expect(unexpected).toEqual([]);
      expect({ status: output.status, suggestion: output.suggestion }).toEqual(testCase.expected);
    },
  );

  it("never proposes a correction for a protected valid address", async () => {
    const protectedCases = corpus.cases.filter(
      (testCase) => testCase.category === "protected-valid",
    );
    expect(protectedCases.length).toBe(50);
    for (const testCase of protectedCases) {
      const output = await validateEmail(testCase.input, {
        rules: czEmailRules,
        lookupDns: async () => answers.resolved_mx,
      });
      expect(output.suggestion).toBeNull();
    }
  });
});
