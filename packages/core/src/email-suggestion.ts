export interface EmailParts {
  readonly local: string;
  readonly domain: string;
}

/**
 * Splits an e-mail address for validation and suggestions. Only the domain is normalized; the
 * local part, its letter case and any +tag stay exactly as typed.
 *
 * The function is self-contained on purpose: the hosted script embeds it through toString(), so it
 * must not reference anything outside its own body.
 */
export function parseEmailForSuggestion(raw: string): EmailParts | null {
  const input = raw.trim();
  const separator = input.lastIndexOf("@");
  if (separator <= 0 || input.indexOf("@") !== separator) return null;
  const local = input.slice(0, separator);
  let domain: string;
  try {
    domain = new URL(`https://${input.slice(separator + 1).toLowerCase()}`).hostname;
  } catch {
    return null;
  }
  if (local.length === 0 || local.length > 64 || domain.length === 0 || domain.length > 253) {
    return null;
  }
  if (
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  ) {
    return null;
  }
  const labels = domain.split(".");
  const labelsValid =
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        !label.startsWith("-") &&
        !label.endsWith("-") &&
        /^[a-z0-9-]+$/.test(label),
    );
  return labelsValid ? { local, domain } : null;
}

/**
 * Proposes a known provider domain for a mistyped one. The name before the suffix must be at least
 * five characters on both sides and differ by one insertion, deletion, substitution or swap of
 * neighbouring characters, with the same suffix. More than one candidate means no proposal; the
 * catalogue order never decides. Internationalised, multi-label and exact provider domains are
 * never guessed.
 */
export function findEmailDomainCandidate(
  domain: string,
  providers: readonly string[],
): string | null {
  if (providers.includes(domain) || domain.includes("xn--")) return null;
  const parts = domain.split(".");
  if (parts.length !== 2) return null;
  const [name, suffix] = parts as [string, string];
  if (name.length < 5) return null;
  const candidates = new Set<string>();
  for (const provider of providers) {
    const providerParts = provider.split(".");
    if (providerParts.length !== 2 || providerParts[1] !== suffix) continue;
    const providerName = providerParts[0] ?? "";
    if (providerName.length >= 5 && withinOneEdit(name, providerName)) candidates.add(provider);
  }
  return candidates.size === 1 ? ([...candidates][0] ?? null) : null;
}

function withinOneEdit(left: string, right: string): boolean {
  if (left === right) return false;
  if (left.length === right.length) {
    const differences: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences.push(index);
      if (differences.length > 2) return false;
    }
    if (differences.length === 1) return true;
    const [first, second] = differences;
    return (
      differences.length === 2 &&
      second === (first ?? 0) + 1 &&
      left[first ?? 0] === right[second] &&
      left[second] === right[first ?? 0]
    );
  }
  if (Math.abs(left.length - right.length) !== 1) return false;
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  let index = 0;
  while (index < shorter.length && shorter[index] === longer[index]) index += 1;
  return shorter.slice(index) === longer.slice(index + 1);
}
