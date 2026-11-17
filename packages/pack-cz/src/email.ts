import { type EmailRules, internationalEmailRules, mergeEmailRules } from "@checkdrop/core";

/** Czech mailbox providers, their reviewed typos and Czech role addresses. */
export const czEmailRuleAdditions: EmailRules = {
  domainCorrections: {
    "gmail.cz": "gmail.com",
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
    "atals.cz": "atlas.cz",
    "atlas.c": "atlas.cz",
    "volny.c": "volny.cz",
    "vonly.cz": "volny.cz",
  },
  providerDomains: ["seznam.cz", "email.cz", "centrum.cz", "atlas.cz", "volny.cz"],
  // Suffix changes such as seznam.com are deliberately excluded because they can be real domains.
  instantCorrections: {
    "seznan.cz": "seznam.cz",
    "seznma.cz": "seznam.cz",
    "seznsm.cz": "seznam.cz",
    "emial.cz": "email.cz",
  },
  disposableDomains: new Set(),
  roleLocalParts: new Set(["fakturace", "kancelar", "obchod", "podpora"]),
};

export const czEmailRules: EmailRules = mergeEmailRules(
  internationalEmailRules,
  czEmailRuleAdditions,
);
