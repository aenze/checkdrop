import type { CountryPack } from "@checkdrop/core";
import { czPack } from "@checkdrop/pack-cz";

/**
 * Installed country packs. A request without a country uses the default pack; a country
 * without a pack is refused, never silently validated by another country's rules.
 */
export const countryPacks: ReadonlyMap<string, CountryPack> = new Map([
  [czPack.manifest.countryCode, czPack],
]);

export const defaultCountryPack: CountryPack = czPack;

export function resolveCountryPack(country: unknown): CountryPack | null {
  if (country === undefined) return defaultCountryPack;
  return typeof country === "string" ? (countryPacks.get(country) ?? null) : null;
}

export function supportedCountriesText(): string {
  return [...countryPacks.keys()].map((code) => `'${code}'`).join(", ");
}
