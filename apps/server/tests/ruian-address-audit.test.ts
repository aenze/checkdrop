import type { AddressSearchResult, AddressSuggestion } from "@checkdrop/db";
import { describe, expect, it } from "vitest";
import { classifyRuianAddress } from "../src/ruian-address-audit.js";

describe("RÚIAN address autocorrection policy", () => {
  it("autocorrects a single strong source-backed match", () => {
    const result = classifyRuianAddress(
      "Karlovo nam. 19/13 Praha",
      matched([
        suggestion("Karlovo náměstí 19/13, 120 00 Praha 2", 0.96),
        suggestion("Karlovo náměstí 20, 120 00 Praha 2", 0.61),
      ]),
    );

    expect(result).toEqual({
      status: "corrected",
      corrected: "Karlovo náměstí 19/13, 120 00 Praha 2",
      reason: "Ověřená a sjednocená podle RÚIAN",
      confidence: 96,
      source: "RÚIAN · 2026-08-03",
    });
  });

  it("autocorrects when only the first candidate contains every input token", () => {
    const first = suggestion("Děčínská 3, Dolní Kamenice, 407 21 Česká Kamenice", 0.9571);
    first.reasons.push("address.all_tokens_match");
    const result = classifyRuianAddress(
      "Decinska 3 Ceska Kamenice",
      matched([first, suggestion("Děčínská 354, 407 21 Česká Kamenice", 0.9212)]),
    );

    expect(result).toMatchObject({
      status: "corrected",
      corrected: "Děčínská 3, Dolní Kamenice, 407 21 Česká Kamenice",
      confidence: 96,
    });
  });

  it("leaves close competing matches unchanged", () => {
    const result = classifyRuianAddress(
      "Lhota 5",
      matched([
        suggestion("Lhota 5, 277 14 Dřísy", 0.91),
        suggestion("Lhota 5, 294 06 Březno", 0.88),
      ]),
    );

    expect(result).toMatchObject({
      status: "warning",
      corrected: null,
      reason: "RÚIAN našel více možných adres",
    });
  });

  it("leaves an address absent from RÚIAN unchanged", () => {
    const result = classifyRuianAddress("Neznámá 999", {
      ...matched([]),
      status: "unknown",
      evidence: {
        source: "ruian-st-uads",
        sourceVersion: null,
        effectiveAt: null,
        state: "absent",
      },
    });

    expect(result).toMatchObject({
      status: "warning",
      corrected: null,
      reason: "Adresa nebyla nalezena v RÚIAN",
    });
  });
});

function matched(suggestions: AddressSuggestion[]): AddressSearchResult {
  return {
    object: "address_search_result",
    status: suggestions.length > 0 ? "matched" : "unknown",
    input: "input",
    normalized: "input",
    suggestions,
    evidence: {
      source: "ruian-st-uads",
      sourceVersion: "2026-08-03T20:00:00.000Z",
      effectiveAt: "2026-08-03T20:00:00.000Z",
      state: "confirmed",
    },
  };
}

function suggestion(addressLine: string, matchScore: number): AddressSuggestion {
  return {
    id: addressLine,
    addressLine,
    municipality: "Praha",
    municipalityPart: null,
    street: "Karlovo náměstí",
    houseNumber: "19",
    orientationNumber: "13",
    postalCode: "12000",
    matchScore,
    reasons: ["address.trigram_candidate"],
  };
}
