import type { EmailRules } from "./email.js";

/**
 * Rules that hold in every country: international mailbox providers, their reviewed typos,
 * disposable services and English role addresses. Country packs add their local providers.
 */
export const internationalEmailRules: EmailRules = {
  domainCorrections: {
    "gmai.com": "gmail.com",
    "gamil.com": "gmail.com",
    "gmal.com": "gmail.com",
    "gmaill.com": "gmail.com",
    "gmeil.com": "gmail.com",
    "gmelj.com": "gmail.com",
    "gmil.com": "gmail.com",
    "gmail.co": "gmail.com",
    "gmail.con": "gmail.com",
    "gmial.com": "gmail.com",
    "gnail.com": "gmail.com",
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
  },
  // Correction targets and known valid variants. Guesses never convert one listed domain into
  // another, and the list does not restrict which domains are accepted.
  providerDomains: [
    "gmail.com",
    "outlook.com",
    "hotmail.com",
    "yahoo.com",
    "icloud.com",
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
  // gmail.co are deliberately excluded because they can be real domains.
  instantCorrections: {
    "gmial.com": "gmail.com",
    "gamil.com": "gmail.com",
    "gmaill.com": "gmail.com",
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
  roleLocalParts: new Set(["admin", "billing", "contact", "info", "office", "sales", "support"]),
};

/** Combines rule sets; a later set wins when two correct the same typo differently. */
export function mergeEmailRules(...sets: readonly EmailRules[]): EmailRules {
  return {
    domainCorrections: Object.assign({}, ...sets.map((rules) => rules.domainCorrections)),
    providerDomains: [...new Set(sets.flatMap((rules) => rules.providerDomains ?? []))],
    instantCorrections: Object.assign({}, ...sets.map((rules) => rules.instantCorrections ?? {})),
    disposableDomains: new Set(sets.flatMap((rules) => [...rules.disposableDomains])),
    roleLocalParts: new Set(sets.flatMap((rules) => [...rules.roleLocalParts])),
  };
}
