import { internationalEmailRules } from "@checkdrop/core";
import { describe, expect, it } from "vitest";
import { czEmailRules } from "../src/index.js";

// Rules as they were before the split into international and Czech parts (release e74f4bd).
// The merged rules must stay equivalent, so no customer sees a different e-mail result.
const rulesBeforeSplit = {
  domainCorrections: {
    "gmai.com": "gmail.com",
    "gamil.com": "gmail.com",
    "gmal.com": "gmail.com",
    "gmaill.com": "gmail.com",
    "gmeil.com": "gmail.com",
    "gmelj.com": "gmail.com",
    "gmil.com": "gmail.com",
    "gmail.cz": "gmail.com",
    "gmail.co": "gmail.com",
    "gmail.con": "gmail.com",
    "gmial.com": "gmail.com",
    "gnail.com": "gmail.com",
    "senam.cz": "seznam.cz",
    "sezam.cz": "seznam.cz",
    "sezman.cz": "seznam.cz",
    "seznan.cz": "seznam.cz",
    "seznma.cz": "seznam.cz",
    "seznsm.cz": "seznam.cz",
    "seznam.con": "seznam.cz",
    "seznam.com": "seznam.cz",
    "seznam.c": "seznam.cz",
    "seznam.cu": "seznam.cz",
    "seznam.czu": "seznam.cz",
    "sznam.cz": "seznam.cz",
    "seynam.cz": "seznam.cz",
    "emai.cz": "email.cz",
    "email.c": "email.cz",
    "email.cu": "email.cz",
    "emial.cz": "email.cz",
    "cenrum.cz": "centrum.cz",
    "centrim.cz": "centrum.cz",
    "centrum.c": "centrum.cz",
    "centrum.cu": "centrum.cz",
    "centum.cz": "centrum.cz",
    "outllok.com": "outlook.com",
    "outlok.com": "outlook.com",
    "outlook.co": "outlook.com",
    "outlook.con": "outlook.com",
    "hotmai.com": "hotmail.com",
    "hotmail.co": "hotmail.com",
    "hotmail.con": "hotmail.com",
    "hotmal.com": "hotmail.com",
    "hotmial.com": "hotmail.com",
    "yaho.com": "yahoo.com",
    "yahoo.co": "yahoo.com",
    "yahoo.con": "yahoo.com",
    "iclou.com": "icloud.com",
    "icloud.co": "icloud.com",
    "icloud.con": "icloud.com",
    "iclud.com": "icloud.com",
    "atals.cz": "atlas.cz",
    "atlas.c": "atlas.cz",
    "volny.c": "volny.cz",
    "vonly.cz": "volny.cz",
  },
  // Correction targets and known valid variants. Guesses never convert one listed domain into
  // another, and the list does not restrict which domains are accepted.
  providerDomains: [
    "gmail.com",
    "seznam.cz",
    "email.cz",
    "centrum.cz",
    "outlook.com",
    "hotmail.com",
    "yahoo.com",
    "icloud.com",
    "atlas.cz",
    "volny.cz",
    "proton.me",
    "protonmail.com",
    "pm.me",
    "protonmail.ch",
    "gmx.de",
    "gmx.net",
    "gmx.at",
    "gmx.ch",
  ],
  // Reviewed typos offered by the hosted script before any request. Suffix changes such as
  // gmail.co or seznam.com are deliberately excluded because they can be real domains.
  instantCorrections: {
    "gmial.com": "gmail.com",
    "gamil.com": "gmail.com",
    "gmaill.com": "gmail.com",
    "seznan.cz": "seznam.cz",
    "seznma.cz": "seznam.cz",
    "seznsm.cz": "seznam.cz",
    "emial.cz": "email.cz",
    "outllok.com": "outlook.com",
    "hotmial.com": "hotmail.com",
    "iclud.com": "icloud.com",
  },
  disposableDomains: new Set([
    "10minutemail.com",
    "guerrillamail.com",
    "mailinator.com",
    "temp-mail.org",
    "yopmail.com",
  ]),
  roleLocalParts: new Set([
    "admin",
    "billing",
    "contact",
    "fakturace",
    "info",
    "kancelar",
    "office",
    "obchod",
    "podpora",
    "sales",
    "support",
  ]),
};

const sorted = (values: Iterable<string>) => [...values].sort();

describe("Czech e-mail rules", () => {
  it("equal the rules before the split", () => {
    expect(czEmailRules.domainCorrections).toEqual(rulesBeforeSplit.domainCorrections);
    expect(czEmailRules.instantCorrections).toEqual(rulesBeforeSplit.instantCorrections);
    expect(sorted(czEmailRules.providerDomains ?? [])).toEqual(
      sorted(rulesBeforeSplit.providerDomains),
    );
    expect(sorted(czEmailRules.disposableDomains)).toEqual(
      sorted(rulesBeforeSplit.disposableDomains),
    );
    expect(sorted(czEmailRules.roleLocalParts)).toEqual(sorted(rulesBeforeSplit.roleLocalParts));
  });

  it("keep Czech providers out of the international rules", () => {
    const international = JSON.stringify([
      internationalEmailRules.domainCorrections,
      internationalEmailRules.providerDomains,
      [...internationalEmailRules.roleLocalParts],
    ]);
    for (const local of ["seznam", "centrum", "atlas", "volny", "email.cz", ".cz", "podpora"]) {
      expect(international).not.toContain(local);
    }
  });
});
