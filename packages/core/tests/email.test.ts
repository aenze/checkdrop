import { describe, expect, it } from "vitest";
import { validateEmail } from "../src/email.js";
import type { DnsLookupResult } from "../src/email.js";

const resolvedDns: DnsLookupResult = {
  state: "resolved",
  hasMx: true,
  hasAddress: true,
  checkedAt: "2026-08-15T08:00:00.000Z",
};

const testRules = {
  domainCorrections: { "gmial.com": "gmail.com" },
  disposableDomains: new Set(["mailinator.com"]),
  roleLocalParts: new Set(["support"]),
};

describe("validateEmail", () => {
  it("normalizes the domain and confirms a healthy mailbox domain", async () => {
    const output = await validateEmail(" Alice@EXAMPLE.com ", {
      lookupDns: async () => resolvedDns,
    });

    expect(output.status).toBe("valid");
    expect(output.normalized).toBe("Alice@example.com");
    expect(output.recommended_action).toBe("accept");
  });

  it("suggests a common domain typo", async () => {
    const lookedUpDomains: string[] = [];
    const output = await validateEmail("alice@gmial.com", {
      lookupDns: async (domain) => {
        lookedUpDomains.push(domain);
        return domain === "gmial.com"
          ? {
              state: "not_found",
              hasMx: false,
              hasAddress: false,
              checkedAt: resolvedDns.checkedAt,
            }
          : resolvedDns;
      },
      rules: testRules,
    });

    expect(output.status).toBe("correctable");
    expect(output.suggestion).toBe("alice@gmail.com");
    expect(output.issues.map((issue) => issue.code)).toContain("email.domain_typo");
    expect(lookedUpDomains.sort()).toEqual(["gmail.com", "gmial.com"]);
  });

  it("marks role addresses and disposable domains as risky", async () => {
    const output = await validateEmail("support@mailinator.com", {
      lookupDns: async () => resolvedDns,
      rules: testRules,
    });

    expect(output.status).toBe("risky");
    expect(output.issues.map((issue) => issue.code)).toEqual([
      "email.domain_disposable",
      "email.local_role",
    ]);
  });

  it("fails open when DNS is unavailable", async () => {
    const output = await validateEmail("alice@example.com", {
      lookupDns: async () => ({
        state: "unavailable",
        hasMx: false,
        hasAddress: false,
        checkedAt: "2026-08-15T08:00:00.000Z",
      }),
    });

    expect(output.status).toBe("unknown");
    expect(output.recommended_action).toBe("fail_open");
  });

  it("does not call DNS for invalid syntax", async () => {
    let calls = 0;
    const output = await validateEmail("not-an-email", {
      lookupDns: async () => {
        calls += 1;
        return resolvedDns;
      },
    });

    expect(output.status).toBe("invalid");
    expect(calls).toBe(0);
  });
});
