import { describe, expect, it } from "vitest";
import { personNameRequirement } from "../src/name-requirement.js";

describe("local required personal name", () => {
  it.each([
    "Jana Nováková",
    " MUDr.Jan Novák ",
    "Ing. Jan Novák, Ph.D.",
    "Anna-Marie Dvořáková",
    "Jean O'Neill",
    "Ludwig van Beethoven",
    "MUDr.Michal POřický",
    "Li Wu",
  ])("accepts complete %s without demanding a formatting change", (value) => {
    expect(personNameRequirement(value)).toBeNull();
  });
  it.each([
    "",
    "  ",
    "Jana",
    "MUDr. Novák",
    "Jan van",
    "J. Novák",
    "J.Novák",
    "J N",
    "Gastro Industries s.r.o.",
    "Jan 😀",
    "Jan Novák2",
    "Jan --Novák",
  ])("rejects incomplete or non-person %s", (value) => {
    expect(personNameRequirement(value)).toBeTypeOf("string");
  });
  it("checks split parts without counting titles or initials", () => {
    expect(personNameRequirement("Jana", "part")).toBeNull();
    expect(personNameRequirement("van Beethoven", "part")).toBeNull();
    expect(personNameRequirement("J.", "part")).not.toBeNull();
    expect(personNameRequirement("MUDr.", "part")).not.toBeNull();
  });
});
