import { validateEmail } from "@checkdrop/core";
import { describe, expect, it } from "vitest";
import addressCases from "../../../fixtures/address-normalization.json" with { type: "json" };
import companyCases from "../../../fixtures/company/cases.json" with { type: "json" };
import vatCases from "../../../fixtures/company/vat-cases.json" with { type: "json" };
import emailCases from "../../../fixtures/email/cases.json" with { type: "json" };
import phoneCases from "../../../fixtures/phone/cases.json" with { type: "json" };
import {
  czEmailRules,
  normalizeCzechAddressSearch,
  validateCzechCompanyId,
  validateCzechPhone,
  validateCzechVatId,
} from "../src/index.js";

// Catalogue typos do not exist; every other domain resolves with MX, like the real providers.
const typoDomains = new Set(Object.keys(czEmailRules.domainCorrections));
const dnsByDomain = async (value: string) =>
  typoDomains.has(value)
    ? ({
        state: "not_found",
        hasMx: false,
        hasAddress: false,
        checkedAt: "2026-09-25T08:00:00Z",
      } as const)
    : ({
        state: "resolved",
        hasMx: true,
        hasAddress: true,
        checkedAt: "2026-09-25T08:00:00Z",
      } as const);

describe("Czech country pack", () => {
  it.each(["seznan.cz", "seznma.cz", "seznsm.cz", "seznam.con"])(
    "suggests seznam.cz for %s, without changing the mailbox",
    async (domain) => {
      const checked: string[] = [];
      const output = await validateEmail(`Example.Person@${domain}`, {
        rules: czEmailRules,
        lookupDns: async (value) => {
          checked.push(value);
          return dnsByDomain(value);
        },
      });
      expect(output.status).toBe("correctable");
      expect(output.suggestion).toBe("Example.Person@seznam.cz");
      expect(output.recommended_action).toBe("suggest");
      expect(checked.sort()).toEqual([domain, "seznam.cz"].sort());
    },
  );
  it("applies Czech email metadata fixtures", async () => {
    for (const fixture of emailCases) {
      const output = await validateEmail(fixture.input, {
        rules: czEmailRules,
        lookupDns: dnsByDomain,
      });
      expect(output.status).toBe(fixture.status);
      if ("normalized" in fixture) expect(output.normalized).toBe(fixture.normalized);
      if ("suggestion" in fixture) expect(output.suggestion).toBe(fixture.suggestion);
    }
  });

  it("validates IČO fixtures", () => {
    for (const fixture of companyCases) {
      const output = validateCzechCompanyId(fixture.input);
      expect(output.status).toBe(fixture.status);
      if ("normalized" in fixture) expect(output.normalized).toBe(fixture.normalized);
      if ("issue" in fixture) expect(output.issues).toContain(fixture.issue);
    }
  });

  it("normalizes Czech DIČ format without claiming VIES registration", () => {
    for (const fixture of vatCases) {
      const output = validateCzechVatId(fixture.input);
      expect(output.status).toBe(fixture.status);
      expect(output.normalized).toBe(fixture.normalized);
      if ("vat_number" in fixture) expect(output.vat_number).toBe(fixture.vat_number);
      if ("issue" in fixture) expect(output.issues).toContain(fixture.issue);
    }
  });

  it("normalizes Czech phone fixtures to E.164", () => {
    for (const fixture of phoneCases) {
      expect(validateCzechPhone(fixture.input)).toMatchObject({
        status: fixture.status,
        normalized: fixture.normalized,
      });
    }
  });

  it("creates deterministic address search fixtures", () => {
    for (const fixture of addressCases) {
      expect(normalizeCzechAddressSearch(fixture.input)).toBe(fixture.normalized);
    }
  });
});
