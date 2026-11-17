import { describe, expect, it } from "vitest";
import { safeNext } from "./sign-in-next";

const origin = "https://checks.example.com";

describe("redirect after sign-in", () => {
  it.each([
    ["?next=%2Fmonitor", "/monitor"],
    ["?next=%2Fintegrations%3Fsite%3Da", "/integrations?site=a"],
    ["", "/dashboard"],
  ])("goes to an administration page for %s", (search, expected) => {
    expect(safeNext(search, origin)).toBe(expected);
  });

  it.each([
    "?next=%2F%5Cevil.example",
    "?next=%2F%09%2Fevil.example",
    "?next=%2F%2Fevil.example",
    "?next=https%3A%2F%2Fevil.example%2Fdashboard",
    "?next=javascript%3Aalert(1)",
    "?next=%2Fsign-in",
    "?next=%2F",
  ])("never leaves for %s", (search) => {
    expect(safeNext(search, origin)).toBe("/dashboard");
  });
});
