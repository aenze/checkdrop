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

export interface CzechVillageNumber {
  /** The house number without its prefix, e.g. "242". */
  readonly houseNumber: string;
  /** RÚIAN TypCislaDomovnihoKod when the customer typed it: "1" č. p., "2" č. ev. */
  readonly houseNumberType: "1" | "2" | null;
  /** What followed the number, kept as typed in a normalized form: "/3", "/3a" or "a". */
  readonly suffix: string;
}

/**
 * Recognises a street field that holds only a house number, as customers in a municipality
 * without streets often type it: "242", "č. p. 242", "čp.242", "č.ev. 12", "242/3" or "242a".
 * Anything with a name in it is not a bare number and returns null.
 */
export function parseCzechVillageNumber(value: string): CzechVillageNumber | null {
  const plain = value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  const match = plain.match(
    /^(?:(c\.?\s*p\.?|cp\.?|c\.?\s*ev\.?|ev\.?\s*c\.?|cislo\s+popisne|cislo\s+evidencni)\s*)?(\d{1,4})(?:\s*\/\s*(\d{1,4})\s*([a-z])?|\s*([a-z]))?$/u,
  );
  if (!match?.[2]) return null;
  const prefix = match[1]?.replace(/[\s.]/g, "") ?? "";
  const houseNumber = match[2].replace(/^0+(?=\d)/, "");
  const suffix = match[3] ? `/${match[3]}${match[4] ?? ""}` : (match[5] ?? "");
  return {
    houseNumber,
    houseNumberType: !prefix
      ? null
      : prefix.includes("ev") || prefix === "cisloevidencni"
        ? "2"
        : "1",
    suffix,
  };
}

/**
 * The official street line of an address point without a street (vyhláška č. 359/2011 Sb.,
 * příloha 1): the name of the municipality part and the house number, e.g. "Sudoměřice 242" or
 * "Dolní Adršpach 13". An evidence number is written with "č. ev.".
 */
export function formatCzechVillageStreetLine(address: {
  readonly municipality: string;
  readonly municipalityPart: string | null;
  readonly houseNumber: string;
  readonly houseNumberType?: string | null;
  readonly orientationNumber?: string | null;
}): string {
  const number = address.orientationNumber
    ? `${address.houseNumber}/${address.orientationNumber}`
    : address.houseNumber;
  return `${address.municipalityPart || address.municipality} ${
    address.houseNumberType === "2" ? "č. ev. " : ""
  }${number}`;
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
