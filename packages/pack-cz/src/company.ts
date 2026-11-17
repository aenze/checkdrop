import {
  type CompanyIdValidation,
  resolveRecommendedAction,
  type VatIdValidation,
} from "@checkdrop/core";

export interface CzechVatIdValidation extends VatIdValidation {
  readonly country_code: "CZ" | null;
}

export function validateCzechCompanyId(input: string): CompanyIdValidation {
  const normalized = input.replace(/\s/g, "");
  if (!/^\d{8}$/.test(normalized)) {
    return {
      status: "invalid",
      recommended_action: "warn",
      normalized: null,
      issues: ["company.ico_format_invalid"],
    };
  }

  const digits = [...normalized].map(Number);
  const sum = digits.slice(0, 7).reduce((total, digit, index) => total + digit * (8 - index), 0);
  const remainder = sum % 11;
  const expected = remainder === 0 ? 1 : remainder === 1 ? 0 : 11 - remainder;
  const valid = digits[7] === expected;

  return {
    status: valid ? "valid" : "invalid",
    recommended_action: resolveRecommendedAction({
      status: valid ? "valid" : "invalid",
      policy: "assist",
    }) as "accept" | "warn",
    normalized,
    issues: valid ? [] : ["company.ico_checksum_invalid"],
  };
}

/**
 * Checks only the Czech DIČ shape and does not claim live registration status.
 */
export function validateCzechVatId(input: string): CzechVatIdValidation {
  const normalized = input
    .trim()
    .toUpperCase()
    .replace(/[\s./_-]+/g, "");

  if (!/^CZ\d{8,10}$/.test(normalized)) {
    return {
      status: "invalid",
      recommended_action: "warn",
      normalized: null,
      country_code: null,
      vat_number: null,
      issues: ["company.vat_format_invalid"],
    };
  }

  return {
    status: "valid",
    recommended_action: "accept",
    normalized,
    country_code: "CZ",
    vat_number: normalized.slice(2),
    issues: [],
  };
}
