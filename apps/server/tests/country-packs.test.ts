import { czPack } from "@checkdrop/pack-cz";
import { describe, expect, it } from "vitest";
import {
  defaultCountryPack,
  resolveCountryPack,
  supportedCountriesText,
} from "../src/country-packs.js";

describe("country packs", () => {
  it("uses the Czech pack when a request names no country", () => {
    expect(defaultCountryPack).toBe(czPack);
    expect(resolveCountryPack(undefined)).toBe(czPack);
    expect(resolveCountryPack("CZ")).toBe(czPack);
  });

  it.each(["SK", "cz", "", null, 420])("refuses %j instead of using another country", (value) => {
    expect(resolveCountryPack(value)).toBeNull();
  });

  it("lists installed countries for error messages", () => {
    expect(supportedCountriesText()).toBe("'CZ'");
  });
});
