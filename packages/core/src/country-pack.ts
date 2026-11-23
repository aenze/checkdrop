import type { EmailRules } from "./email.js";

export type CapabilityStatus = "experimental" | "stable";

export interface CountryPackManifest {
  readonly schemaVersion: 1;
  /** ISO 3166-1 alpha-2 code in upper case. */
  readonly countryCode: string;
  readonly status: CapabilityStatus;
  readonly capabilities: Readonly<Partial<Record<CountryCapability, CapabilityStatus>>>;
}

export type CountryCapability =
  | "email"
  | "phone"
  | "companyId"
  | "addressNormalization"
  | "addressSearch"
  | "vat";

export interface PhoneValidation {
  readonly status: "valid" | "correctable" | "risky" | "invalid";
  readonly recommended_action: "accept" | "suggest" | "warn";
  readonly normalized: string | null;
  readonly issues: readonly string[];
}

export interface CompanyIdValidation {
  readonly status: "valid" | "invalid";
  readonly recommended_action: "accept" | "warn";
  readonly normalized: string | null;
  readonly issues: readonly string[];
}

/** Checks only the shape of a VAT id; live registration status comes from a data provider. */
export interface VatIdValidation {
  readonly status: "valid" | "invalid";
  readonly recommended_action: "accept" | "warn";
  readonly normalized: string | null;
  readonly country_code: string | null;
  readonly vat_number: string | null;
  readonly issues: readonly string[];
}

/** One street line split into its name and numbers; null when the line ends without a number. */
export interface StreetNumberParts {
  readonly street: string | null;
  readonly houseNumber: string;
  readonly orientationNumber: string | null;
}

/**
 * Everything that differs between countries. Core validation stays country-neutral; the
 * server picks a pack by the request's country code, and a country without a pack is refused.
 */
export interface CountryPack {
  readonly manifest: CountryPackManifest;
  /** English country name used in API messages, such as "Czech Republic". */
  readonly name: string;
  /** International rules already merged with the country's own providers and role words. */
  readonly emailRules: EmailRules;
  readonly embedTexts: EmbedTexts;
  /** The same texts in other languages, keyed by language code; the page language picks one. */
  readonly embedTranslations?: Readonly<Record<string, EmbedTexts>>;
  readonly phone: {
    readonly validate: (input: string) => PhoneValidation;
  };
  readonly company: {
    readonly validateId: (input: string) => CompanyIdValidation;
    readonly validateVatId: (input: string) => VatIdValidation;
  };
  readonly address: {
    /** Folds case, diacritics and local abbreviations for search and comparison. */
    readonly normalizeSearch: (input: string) => string;
    readonly parseStreetNumber: (value: string) => StreetNumberParts | null;
    /** True only for clear signals of another country, never for an unknown address. */
    readonly looksForeign: (
      address: string,
      city: string | null,
      postalCode: string | null,
    ) => boolean;
  };
}

/**
 * Customer-facing texts of the hosted script, supplied by a country pack. Values in braces,
 * such as {postal_code}, are filled in by the script. Keys stay stable across languages.
 */
export interface EmbedTexts {
  /** BCP 47 language tag of the texts, such as "cs". */
  readonly locale: string;
  readonly phonePrefill: string;
  readonly phonePlaceholder: string;
  readonly messages: Readonly<Record<EmbedMessageKey, string>>;
}

export type EmbedMessageKey =
  | "address.incomplete"
  | "address.pick"
  | "address.house_number_missing"
  | "address.not_verified"
  | "address.foreign_country"
  | "address.postal_code_mismatch"
  | "address.suggestions_label"
  | "address.filled"
  | "address.undo_label"
  | "company.id_invalid"
  | "company.not_found"
  | "company.suggestions_label"
  | "company.pick"
  | "company.filled"
  | "company.confirmed"
  | "correction.question_prefix_email"
  | "correction.question_suffix"
  | "correction.title"
  | "correction.apply"
  | "correction.apply_label"
  | "correction.keep"
  | "correction.keep_label"
  | "email.syntax_invalid"
  | "email.domain_no_dns"
  | "field.email"
  | "field.name"
  | "name.incomplete"
  | "name.company_in_contact"
  | "name.invalid_characters"
  | "name.capitalization"
  | "name.ok"
  | "phone.impossible"
  | "phone.foreign"
  | "phone.required"
  | "phone.email"
  | "phone.invalid"
  | "undo";
