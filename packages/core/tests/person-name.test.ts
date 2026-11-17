import { describe, expect, it } from "vitest";
import { validatePersonName } from "../src/person-name.js";

describe("person-name validation", () => {
  it("collapses whitespace and removes stray terminal punctuation", () => {
    const result = validatePersonName("  Pavel\u00a0  Novak , ");
    expect(result.normalized).toBe("Pavel Novak");
    expect(result.status).toBe("correctable");
    expect(result.suggestion).toBe("Pavel Novak");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "person.whitespace_normalized",
      "person.trailing_punctuation",
    ]);
  });

  it("requires a combined given name and surname", () => {
    const result = validatePersonName("Lukas");
    expect(result.status).toBe("invalid");
    expect(result.issues.map((issue) => issue.code)).toContain("person.full_name_incomplete");
  });

  it("rejects company names for a private customer", () => {
    const result = validatePersonName("Gastro Industries s.r.o.", { customerType: "private" });
    expect(result.status).toBe("invalid");
    expect(result.normalized).toBe("Gastro Industries s.r.o.");
    expect(result.issues.map((issue) => issue.code)).toContain("person.company_name_in_contact");
  });

  it("preserves a company suffix for a company customer", () => {
    const result = validatePersonName("Gastro Industries s.r.o.", { customerType: "company" });
    expect(result.status).toBe("valid");
    expect(result.normalized).toBe("Gastro Industries s.r.o.");
  });

  it("preserves Czech names, titles, hyphens and apostrophes", () => {
    for (const value of [
      "Ing. Jan Novák",
      "Anna-Marie Dvořáková",
      "Jean O'Neill",
      "Ludwig van Beethoven",
      "Sean McDonald",
    ]) {
      const result = validatePersonName(value);
      expect(result.status).toBe("valid");
      expect(result.normalized).toBe(value);
    }
  });

  it("safely normalizes title spacing and unambiguous Czech capitalization", () => {
    const result = validatePersonName("MUDr.Michal POřický");

    expect(result.status).toBe("correctable");
    expect(result.recommended_action).toBe("suggest");
    expect(result.normalized).toBe("MUDr. Michal Pořický");
    expect(result.suggestion).toBe("MUDr. Michal Pořický");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "person.title_normalized",
      "person.capitalization_normalized",
    ]);
  });

  it.each([
    ["ing. arch. jan NOVÁK", "Ing. arch. Jan Novák"],
    ["prof.MUDr.JAN NOVÁK", "prof. MUDr. Jan Novák"],
    ["Jan NOVÁK ph.d.", "Jan Novák Ph.D."],
    ["anna-marie dvořáková", "Anna-Marie Dvořáková"],
    ["jean o'neill", "Jean O'Neill"],
  ])("normalizes known safe form %s", (input, expected) => {
    const result = validatePersonName(input);
    expect(result.status).toBe("correctable");
    expect(result.suggestion).toBe(expected);
  });

  it("accepts every supported title in its canonical form", () => {
    const prefixTitles = [
      "Bc.",
      "BcA.",
      "Ing.",
      "Ing. arch.",
      "Mgr.",
      "MgA.",
      "MUDr.",
      "MDDr.",
      "MVDr.",
      "JUDr.",
      "PhDr.",
      "RNDr.",
      "PharmDr.",
      "ThDr.",
      "doc.",
      "prof.",
    ];
    const suffixTitles = [
      "DiS.",
      "Ph.D.",
      "Th.D.",
      "CSc.",
      "DrSc.",
      "DSc.",
      "MBA",
      "LL.M.",
      "MSc.",
      "MPA",
    ];

    for (const title of prefixTitles) {
      expect(validatePersonName(`${title} Jan Novák`).status, title).toBe("valid");
    }
    for (const title of suffixTitles) {
      expect(validatePersonName(`Jan Novák ${title}`).status, title).toBe("valid");
    }
  });

  it("normalizes a compact initial without treating it as a title", () => {
    const result = validatePersonName("j.Novák");

    expect(result.status).toBe("correctable");
    expect(result.suggestion).toBe("J. Novák");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "person.initial_spacing_normalized",
      "person.capitalization_normalized",
    ]);
  });

  it("normalizes multiple compact initials without changing a company suffix", () => {
    const result = validatePersonName("j.k.Novák");
    expect(result.status).toBe("correctable");
    expect(result.suggestion).toBe("J. K. Novák");
  });

  it("does not count titles or lowercase particles as missing name components", () => {
    const incomplete = validatePersonName("MUDr. Novák");
    const complete = validatePersonName("Jean de la Cruz");

    expect(incomplete.status).toBe("invalid");
    expect(incomplete.suggestion).toBeNull();
    expect(incomplete.issues.map((issue) => issue.code)).toContain("person.full_name_incomplete");
    expect(complete.status).toBe("valid");
  });

  it("warns about ambiguous mixed capitalization without rewriting it", () => {
    const result = validatePersonName("Jan MiChal");

    expect(result.status).toBe("risky");
    expect(result.recommended_action).toBe("warn");
    expect(result.normalized).toBe("Jan MiChal");
    expect(result.suggestion).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain("person.capitalization_ambiguous");
  });

  it.each([
    ["Jan Novák2", "person.invalid_characters"],
    ["Jan 😀 Novák", "person.invalid_characters"],
    ["Jan O''Neill", "person.separator_invalid"],
    ["Jan -Novák", "person.separator_invalid"],
  ])("rejects malformed name %s", (input, issueCode) => {
    const result = validatePersonName(input);
    expect(result.status).toBe("invalid");
    expect(result.suggestion).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain(issueCode);
  });

  it("does not guess missing diacritics", () => {
    const result = validatePersonName("Jan Novak");
    expect(result.status).toBe("valid");
    expect(result.normalized).toBe("Jan Novak");
    expect(result.suggestion).toBeNull();
  });

  it("marks an empty value as missing instead of skipping it", () => {
    const result = validatePersonName("   ");
    expect(result.status).toBe("invalid");
    expect(result.issues.map((issue) => issue.code)).toEqual(["person.full_name_missing"]);
  });
});
