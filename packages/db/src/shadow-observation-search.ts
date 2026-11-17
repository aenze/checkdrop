import { createHash, createHmac } from "node:crypto";

const KEY_BYTES = 32;
const MIN_TERM_LENGTH = 2;
const MAX_PREFIX_LENGTH = 40;
const MAX_SEARCH_TOKENS = 256;
const SEARCH_INDEX_VERSION = 1;

export interface ShadowObservationSearchIndex {
  readonly version: typeof SEARCH_INDEX_VERSION;
  valueTokens(value: string): readonly string[];
  queryTokens(query: string): readonly string[];
}

export function createShadowObservationSearchIndex(
  encodedKey: string | null | undefined,
): ShadowObservationSearchIndex | null {
  const compactKey = encodedKey?.trim();
  if (!compactKey) return null;
  const encryptionKey = Buffer.from(compactKey, "base64url");
  if (encryptionKey.length !== KEY_BYTES) {
    throw new Error("CHECKDROP_OBSERVATION_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  const searchKey = createHash("sha256")
    .update("checkdrop-shadow-search-v1\0", "utf8")
    .update(encryptionKey)
    .digest();
  const digest = (term: string) => createHmac("sha256", searchKey).update(term).digest("hex");

  return {
    version: SEARCH_INDEX_VERSION,
    valueTokens(value) {
      return [...collectValueTerms(value)].slice(0, MAX_SEARCH_TOKENS).map(digest).sort();
    },
    queryTokens(query) {
      return [...collectQueryTerms(query)].map(digest).sort();
    },
  };
}

function collectValueTerms(value: string): Set<string> {
  const segments = searchSegments(value);
  const terms = new Set<string>();
  for (const segment of segments) addPrefixes(terms, segment);
  for (const initials of consecutiveInitialGroups(segments)) addPrefixes(terms, initials);
  const compact = segments.join("");
  if (compact.length >= 3) {
    addPrefixes(terms, compact, 3);
    if (/^\d+$/.test(compact) && compact.length > 9) addPrefixes(terms, compact.slice(-9), 3);
  }
  return terms;
}

function collectQueryTerms(query: string): Set<string> {
  const segments = searchSegments(query);
  const terms = new Set(segments.filter((segment) => segment.length >= MIN_TERM_LENGTH));
  if (terms.size === 0) {
    for (const initials of consecutiveInitialGroups(segments)) {
      if (initials.length >= MIN_TERM_LENGTH) terms.add(initials);
    }
  }
  const compact = segments.join("");
  if (terms.size === 0 && compact.length >= MIN_TERM_LENGTH) terms.add(compact);
  return terms;
}

function searchSegments(value: string): string[] {
  return (
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("cs-CZ")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function addPrefixes(terms: Set<string>, value: string, minimum = MIN_TERM_LENGTH) {
  if (value.length < minimum) return;
  const prefixLimit = Math.min(value.length, MAX_PREFIX_LENGTH);
  for (let length = minimum; length <= prefixLimit; length += 1) {
    terms.add(value.slice(0, length));
  }
  terms.add(value);
}

function consecutiveInitialGroups(segments: readonly string[]): string[] {
  const groups: string[] = [];
  let current = "";
  for (const segment of segments) {
    if (segment.length === 1) {
      current += segment;
      continue;
    }
    if (current.length > 1) groups.push(current);
    current = "";
  }
  if (current.length > 1) groups.push(current);
  return groups;
}
