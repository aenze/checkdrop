import type { CountryPack } from "@checkdrop/core";
import {
  looksForeignToCzechia,
  normalizeCzechAddressSearch,
  parseCzechStreetNumber,
} from "./address.js";
import { validateCzechCompanyId, validateCzechVatId } from "./company.js";
import { czEmailRules } from "./email.js";
import { czEmbedTexts, czEmbedTextsEn } from "./embed-texts.js";
import { validateCzechPhone } from "./phone.js";

export * from "./address.js";
export * from "./company.js";
export * from "./email.js";
export * from "./embed-texts.js";
export * from "./phone.js";

export const czPackManifest = {
  schemaVersion: 1,
  countryCode: "CZ",
  status: "experimental",
  capabilities: {
    email: "experimental",
    phone: "experimental",
    companyId: "experimental",
    addressNormalization: "experimental",
    addressSearch: "experimental",
    vat: "experimental",
  },
} as const;

export const czPack = {
  manifest: czPackManifest,
  name: "Czech Republic",
  emailRules: czEmailRules,
  embedTexts: czEmbedTexts,
  embedTranslations: { cs: czEmbedTexts, en: czEmbedTextsEn },
  phone: { validate: validateCzechPhone },
  company: { validateId: validateCzechCompanyId, validateVatId: validateCzechVatId },
  address: {
    normalizeSearch: normalizeCzechAddressSearch,
    parseStreetNumber: parseCzechStreetNumber,
    looksForeign: looksForeignToCzechia,
  },
} as const satisfies CountryPack;
