import type { StreetNumberParts } from "@checkdrop/core";

const abbreviations: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bnam\.?(?=\s|$)/g, "namesti"],
  [/\bnabr\.?(?=\s|$)/g, "nabrezi"],
  [/\btr\.?(?=\s|$)/g, "trida"],
  [/\bul\.?(?=\s|$)/g, ""],
];

export function normalizeCzechAddressSearch(input: string): string {
  let normalized = input.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  for (const [pattern, replacement] of abbreviations) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface CzechAddressComponents {
  readonly street_line: string;
  readonly city: string;
  readonly postal_code: string;
}

/**
 * Splits a street line into the street name, house number and optional orientation number,
 * including its letter ("17. listopadu 12/4a"). A line without a trailing number is not parsed,
 * so digits inside a street name never count as a house number.
 */
export function parseCzechStreetNumber(value: string): StreetNumberParts | null {
  const match = value.trim().match(/^(?:(.*?)\s+)?(\d+)(?:\s*\/\s*(\d+[a-zA-Z]?))?$/u);
  if (!match?.[2]) return null;
  return {
    street: match[1]?.trim() || null,
    houseNumber: match[2],
    orientationNumber: match[3]?.toLowerCase() ?? null,
  };
}

/**
 * Flags an address that clearly belongs to another country, such as a Slovak PSČ or country name.
 * Only obvious signals count, so a Czech address is never refused by guesswork: a Czech PSČ always
 * starts with 1–7, and the letters ä, ô, ľ, ĺ and ŕ never appear in a Czech municipality name.
 * Street names are not judged, because Czech streets are often named after Slovak towns.
 * The hosted checkout script embeds this function as source, so it must stay self-contained.
 */
export function looksForeignToCzechia(
  address: string,
  city: string | null,
  postalCode: string | null,
): boolean {
  const compactPostalCode = postalCode?.replace(/\D/g, "") ?? "";
  if (compactPostalCode.length === 5 && !/^[1-7]/.test(compactPostalCode)) return true;
  if (/[äôľĺŕ]/i.test(city ?? "")) return true;

  const normalized = `${address} ${city ?? ""}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return (
    /\b(?:slovensko|slovenska republika|slovakia)\b/.test(normalized) ||
    /\bsk\s*-?\s*\d{3}\s?\d{2}\b/.test(normalized)
  );
}
