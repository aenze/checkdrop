import type { AddressSearchResult } from "@checkdrop/db";

export interface AddressAuditResolution {
  readonly status: "clean" | "corrected" | "warning";
  readonly corrected: string | null;
  readonly reason: string;
  readonly confidence: number | null;
  readonly source: string;
}

const AUTO_CORRECT_SCORE = 0.9;
const AUTO_CORRECT_GAP = 0.08;

export function classifyRuianAddress(
  original: string,
  result: AddressSearchResult,
): AddressAuditResolution {
  const source = result.evidence.sourceVersion
    ? `RÚIAN · ${result.evidence.sourceVersion.slice(0, 10)}`
    : "RÚIAN";
  const first = result.suggestions[0];
  if (result.status !== "matched" || !first) {
    return {
      status: "warning",
      corrected: null,
      reason: "Adresa nebyla nalezena v RÚIAN",
      confidence: null,
      source,
    };
  }

  const second = result.suggestions[1];
  const exact = first.reasons.includes("address.exact_normalized_match");
  const allInputTokensMatch =
    first.reasons.includes("address.all_tokens_match") &&
    !second?.reasons.includes("address.all_tokens_match");
  const separated = !second || first.matchScore - second.matchScore >= AUTO_CORRECT_GAP;
  const safe =
    exact || allInputTokensMatch || (first.matchScore >= AUTO_CORRECT_SCORE && separated);
  const confidence = Math.round(first.matchScore * 100);
  if (!safe) {
    return {
      status: "warning",
      corrected: null,
      reason: second ? "RÚIAN našel více možných adres" : "Shoda s RÚIAN není dostatečně jistá",
      confidence,
      source,
    };
  }

  const official = first.addressLine.trim();
  if (official === original.trim()) {
    return {
      status: "clean",
      corrected: original,
      reason: "Adresa odpovídá RÚIAN",
      confidence,
      source,
    };
  }
  return {
    status: "corrected",
    corrected: official,
    reason: "Ověřená a sjednocená podle RÚIAN",
    confidence,
    source,
  };
}
