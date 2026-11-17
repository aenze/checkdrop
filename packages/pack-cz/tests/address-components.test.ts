import { describe, expect, it } from "vitest";
import { parseCzechStreetNumber } from "../src/index.js";

describe("Czech street number parsing", () => {
  it("keeps digits inside the street name and the orientation letter", () => {
    expect(parseCzechStreetNumber("17. listopadu 12/4a")).toEqual({
      street: "17. listopadu",
      houseNumber: "12",
      orientationNumber: "4a",
    });
    expect(parseCzechStreetNumber("Dlouhá 555 / 54A")).toEqual({
      street: "Dlouhá",
      houseNumber: "555",
      orientationNumber: "54a",
    });
  });

  it("accepts a village number without a street", () => {
    expect(parseCzechStreetNumber("134")).toEqual({
      street: null,
      houseNumber: "134",
      orientationNumber: null,
    });
  });

  it("does not treat a street name ending with a word as having a number", () => {
    expect(parseCzechStreetNumber("17. listopadu")).toBeNull();
    expect(parseCzechStreetNumber("Sokolská")).toBeNull();
    expect(parseCzechStreetNumber("")).toBeNull();
  });
});
