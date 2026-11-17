import { describe, expect, it } from "vitest";
import { createShadowObservationSearchIndex } from "../src/shadow-observation-search.js";

const testKey = Buffer.alloc(32, 7).toString("base64url");

describe("shadow observation blind search index", () => {
  it.each([
    ["Andrea Králová", "král"],
    ["Gastro Industries s.r.o.", "Gastro Industries"],
    ["Gastro Industries s.r.o.", "sro"],
    ["andie.kralova@gmail.com", "kralova@gmail"],
    ["+420 777 762 456", "777762456"],
    ["23603453", "23603453"],
  ])("finds %s from %s without storing the query", (value, query) => {
    const index = createShadowObservationSearchIndex(testKey);
    const valueTokens = index?.valueTokens(value) ?? [];
    const queryTokens = index?.queryTokens(query) ?? [];

    expect(queryTokens.length).toBeGreaterThan(0);
    expect(queryTokens.every((token) => valueTokens.includes(token))).toBe(true);
    expect(valueTokens.join(" ")).not.toContain(value.toLocaleLowerCase("cs-CZ"));
    expect(valueTokens.every((token) => /^[a-f0-9]{64}$/.test(token))).toBe(true);
  });

  it("is deterministic, accent-insensitive, and key-scoped", () => {
    const index = createShadowObservationSearchIndex(testKey);
    const other = createShadowObservationSearchIndex(Buffer.alloc(32, 8).toString("base64url"));

    expect(index?.queryTokens("Králová")).toEqual(index?.queryTokens("kralova"));
    expect(index?.queryTokens("Králová")).not.toEqual(other?.queryTokens("Králová"));
  });
});
