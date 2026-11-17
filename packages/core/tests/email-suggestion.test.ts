import { describe, expect, it, vi } from "vitest";
import type { DnsLookupResult, EmailRules } from "../src/index.js";
import { findEmailDomainCandidate, parseEmailForSuggestion, validateEmail } from "../src/index.js";

const at = "2026-09-25T08:00:00.000Z";
const resolved: DnsLookupResult = {
  state: "resolved",
  hasMx: true,
  hasAddress: true,
  checkedAt: at,
};
const addressOnly: DnsLookupResult = {
  state: "resolved",
  hasMx: false,
  hasAddress: true,
  checkedAt: at,
};
const notFound: DnsLookupResult = {
  state: "not_found",
  hasMx: false,
  hasAddress: false,
  checkedAt: at,
};
const unavailable: DnsLookupResult = {
  state: "unavailable",
  hasMx: false,
  hasAddress: false,
  checkedAt: at,
};

const rules: EmailRules = {
  domainCorrections: { "gmial.com": "gmail.com", "seznam.com": "seznam.cz" },
  disposableDomains: new Set(),
  roleLocalParts: new Set(),
  providerDomains: [
    "gmail.com",
    "seznam.cz",
    "protonmail.com",
    "protonmail.ch",
    "abcde.com",
    "abcef.com",
  ],
};

function dns(answers: Record<string, DnsLookupResult>) {
  return vi.fn(async (domain: string) => answers[domain] ?? resolved);
}

describe("e-mail parsing for suggestions", () => {
  it("normalizes only the domain and keeps the mailbox as typed", () => {
    expect(parseEmailForSuggestion(" Alice+shop@GMAIL.COM ")).toEqual({
      local: "Alice+shop",
      domain: "gmail.com",
    });
  });

  it.each([
    "a@@gmail.com",
    "jana@",
    "@gmail.com",
    "jana novakova@gmail.com",
    "jana..n@gmail.com",
    "jana@gmail",
  ])("rejects %s", (value) => expect(parseEmailForSuggestion(value)).toBeNull());

  it("runs on its own, as the hosted script embeds it through toString", () => {
    const standalone = new Function(
      `return (${parseEmailForSuggestion.toString()})`,
    )() as typeof parseEmailForSuggestion;
    expect(standalone("Jana@Seznam.CZ")).toEqual({ local: "Jana", domain: "seznam.cz" });
  });
});

describe("provider domain candidates", () => {
  it("finds one-edit typos with the same suffix", () => {
    expect(findEmailDomainCandidate("protonmial.com", ["protonmail.com"])).toBe("protonmail.com");
    expect(findEmailDomainCandidate("protnmail.com", ["protonmail.com"])).toBe("protonmail.com");
    expect(findEmailDomainCandidate("protonmaill.com", ["protonmail.com"])).toBe("protonmail.com");
  });

  it("never converts between known providers, suffixes or ambiguous candidates", () => {
    expect(
      findEmailDomainCandidate("protonmail.ch", ["protonmail.com", "protonmail.ch"]),
    ).toBeNull();
    expect(findEmailDomainCandidate("gmail.co", ["gmail.com"])).toBeNull();
    expect(findEmailDomainCandidate("abced.com", ["abcde.com", "abcef.com"])).toBeNull();
    expect(findEmailDomainCandidate("gmal.com", ["gmail.com"])).toBeNull(); // name shorter than five
    expect(findEmailDomainCandidate("mail.gmial.com", ["gmail.com"])).toBeNull();
    expect(findEmailDomainCandidate("xn--gmil-5qa.com", ["gmail.com"])).toBeNull();
  });
});

describe("e-mail corrections verified against DNS", () => {
  it("proposes a reviewed catalogue correction even when the typo domain resolves", async () => {
    // Typosquatted domains such as gamil.com have MX records and would capture the mail.
    const lookupDns = dns({ "gmial.com": resolved });
    const output = await validateEmail("jana@gmial.com", { lookupDns, rules });
    expect(output).toMatchObject({ status: "correctable", suggestion: "jana@gmail.com" });
  });

  it("does not propose a catalogue correction when the target has no MX or DNS is unavailable", async () => {
    expect(
      await validateEmail("jana@gmial.com", {
        lookupDns: dns({ "gmial.com": resolved, "gmail.com": addressOnly }),
        rules,
      }),
    ).toMatchObject({ status: "valid", suggestion: null });
    expect(
      await validateEmail("jana@gmial.com", {
        lookupDns: dns({ "gmial.com": notFound, "gmail.com": unavailable }),
        rules,
      }),
    ).toMatchObject({ status: "unknown", suggestion: null });
  });

  it("proposes a catalogue correction when the original does not exist and the target has MX", async () => {
    const lookupDns = dns({ "gmial.com": notFound });
    const output = await validateEmail("Alice+shop@gmial.com", { lookupDns, rules });
    expect(output).toMatchObject({ status: "correctable", suggestion: "Alice+shop@gmail.com" });
    expect(lookupDns).toHaveBeenCalledTimes(2);
  });

  it("guesses a provider only after the original is confirmed missing", async () => {
    const lookupDns = dns({ "protonmial.com": notFound });
    const output = await validateEmail("jana@protonmial.com", { lookupDns, rules });
    expect(output).toMatchObject({ status: "correctable", suggestion: "jana@protonmail.com" });
    expect(lookupDns.mock.calls.map(([domain]) => domain)).toEqual([
      "protonmial.com",
      "protonmail.com",
    ]);
  });

  it("does not guess for a working company domain one character away from a provider", async () => {
    const lookupDns = dns({ "abcdf.com": resolved });
    const output = await validateEmail("jana@abcdf.com", { lookupDns, rules });
    expect(output.suggestion).toBeNull();
    expect(lookupDns).toHaveBeenCalledTimes(1);
  });

  it("returns unknown without any guess when DNS of the original is unavailable", async () => {
    const lookupDns = dns({ "protonmial.com": unavailable });
    const output = await validateEmail("jana@protonmial.com", { lookupDns, rules });
    expect(output).toMatchObject({ status: "unknown", suggestion: null });
    expect(lookupDns).toHaveBeenCalledTimes(1);
  });

  it("does not propose a target without MX", async () => {
    const lookupDns = dns({ "gmial.com": notFound, "gmail.com": addressOnly });
    const output = await validateEmail("jana@gmial.com", { lookupDns, rules });
    expect(output).toMatchObject({ status: "invalid", suggestion: null });
    expect(output.issues.map((issue) => issue.code)).toEqual(["email.domain_no_dns"]);
  });

  it("does not propose anything for an unknown domain without a candidate", async () => {
    const lookupDns = dns({ "neexistuje-checkdrop.cz": notFound });
    const output = await validateEmail("jana@neexistuje-checkdrop.cz", { lookupDns, rules });
    expect(output).toMatchObject({ status: "invalid", suggestion: null });
  });

  it("treats a thrown lookup as unavailable", async () => {
    const lookupDns = vi.fn(async () => {
      throw new Error("resolver down");
    });
    const output = await validateEmail("jana@protonmial.com", { lookupDns, rules });
    expect(output.status).toBe("unknown");
  });

  it("shares one deadline across the whole DNS phase", async () => {
    // Without the shared deadline two sequential 200 ms lookups would take about 400 ms.
    const lookupDns = vi.fn(
      (domain: string) =>
        new Promise<DnsLookupResult>((resolve) =>
          setTimeout(() => resolve(domain === "protonmial.com" ? notFound : resolved), 200),
        ),
    );
    const started = performance.now();
    const output = await validateEmail("jana@protonmial.com", {
      lookupDns,
      rules,
      dnsBudgetMs: 50,
    });
    expect(output.status).toBe("unknown");
    expect(performance.now() - started).toBeLessThan(150);
  });
});
