import { describe, expect, it } from "vitest";
import { formatCzechVillageStreetLine, parseCzechVillageNumber } from "../src/index.js";

describe("bare house number in a street field", () => {
  it("recognises a number alone, with a slash or with a letter", () => {
    expect(parseCzechVillageNumber("242")).toEqual({
      houseNumber: "242",
      houseNumberType: null,
      suffix: "",
    });
    expect(parseCzechVillageNumber(" 242 / 3 ")).toEqual({
      houseNumber: "242",
      houseNumberType: null,
      suffix: "/3",
    });
    expect(parseCzechVillageNumber("242/3B")).toMatchObject({ houseNumber: "242", suffix: "/3b" });
    expect(parseCzechVillageNumber("242a")).toEqual({
      houseNumber: "242",
      houseNumberType: null,
      suffix: "a",
    });
  });

  it("reads the č. p. and č. ev. prefixes customers type", () => {
    for (const typed of [
      "č.p. 242",
      "č. p. 242",
      "čp 242",
      "čp.242",
      "C.P.242",
      "číslo popisné 242",
    ]) {
      expect(parseCzechVillageNumber(typed), typed).toEqual({
        houseNumber: "242",
        houseNumberType: "1",
        suffix: "",
      });
    }
    for (const typed of ["č.ev. 12", "č. ev. 12", "ev.č. 12", "ev. č. 12"]) {
      expect(parseCzechVillageNumber(typed), typed).toEqual({
        houseNumber: "12",
        houseNumberType: "2",
        suffix: "",
      });
    }
  });

  it("does not take a street, a village name or a PSČ for a bare number", () => {
    expect(parseCzechVillageNumber("Sudoměřice 242")).toBeNull();
    expect(parseCzechVillageNumber("Hlavní 12")).toBeNull();
    expect(parseCzechVillageNumber("69666")).toBeNull();
    expect(parseCzechVillageNumber("242 ab")).toBeNull();
    expect(parseCzechVillageNumber("")).toBeNull();
    expect(parseCzechVillageNumber("č.p.")).toBeNull();
  });
});

describe("official street line of an address point without a street", () => {
  it("uses the part of the municipality and the house number", () => {
    expect(
      formatCzechVillageStreetLine({
        municipality: "Sudoměřice",
        municipalityPart: "Sudoměřice",
        houseNumber: "242",
        houseNumberType: "1",
      }),
    ).toBe("Sudoměřice 242");
    expect(
      formatCzechVillageStreetLine({
        municipality: "Adršpach",
        municipalityPart: "Dolní Adršpach",
        houseNumber: "13",
      }),
    ).toBe("Dolní Adršpach 13");
  });

  it("falls back to the municipality and marks an evidence number", () => {
    expect(
      formatCzechVillageStreetLine({
        municipality: "Chatová",
        municipalityPart: null,
        houseNumber: "8",
        houseNumberType: "2",
      }),
    ).toBe("Chatová č. ev. 8");
  });
});
