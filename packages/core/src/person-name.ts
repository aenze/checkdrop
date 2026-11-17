import type { RecommendedAction, ValidationPolicy, ValidationStatus } from "./index.js";
import { resolveRecommendedAction } from "./index.js";

export type CustomerType = "private" | "company";
export type PersonNameContext = "billing" | "shipping";

export type PersonNameIssueCode =
  | "person.full_name_missing"
  | "person.full_name_incomplete"
  | "person.company_name_in_contact"
  | "person.whitespace_normalized"
  | "person.trailing_punctuation"
  | "person.title_normalized"
  | "person.capitalization_normalized"
  | "person.initial_spacing_normalized"
  | "person.capitalization_ambiguous"
  | "person.invalid_characters"
  | "person.separator_invalid";

export interface PersonNameIssue {
  readonly code: PersonNameIssueCode;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
}

export interface PersonNameValidationResult {
  readonly status: ValidationStatus;
  readonly recommended_action: RecommendedAction;
  readonly normalized: string | null;
  readonly suggestion: string | null;
  readonly issues: readonly PersonNameIssue[];
  readonly evidence: readonly {
    readonly source: "name_rules";
    readonly checked_at: string;
    readonly state: "confirmed" | "absent";
    readonly detail?: string;
  }[];
}

export interface PersonNameValidationOptions {
  readonly customerType?: CustomerType;
  readonly context?: PersonNameContext;
  readonly policy?: Exclude<ValidationPolicy, "custom">;
  readonly allowBlocking?: boolean;
  readonly now?: () => Date;
}

interface NameNormalization {
  readonly value: string;
  readonly whitespaceChanged: boolean;
  readonly trailingPunctuationChanged: boolean;
  readonly titleChanged: boolean;
  readonly initialSpacingChanged: boolean;
  readonly capitalizationChanged: boolean;
  readonly capitalizationAmbiguous: boolean;
}

interface CasingResult {
  readonly value: string;
  readonly changed: boolean;
  readonly ambiguous: boolean;
}

const companyNamePattern =
  /(?:\bs\.?\s*r\.?\s*o\.?\b|\ba\.?\s*s\.?\b|\bspol\.?\s+s\s+r\.?\s*o\.?\b|\bv\.?\s*o\.?\s*s\.?\b|\bdružstvo\b)/iu;

const prefixTitles = [
  "Ing. arch.",
  "PharmDr.",
  "MUDr.",
  "MDDr.",
  "MVDr.",
  "JUDr.",
  "PhDr.",
  "RNDr.",
  "ThDr.",
  "BcA.",
  "Ing.",
  "Mgr.",
  "MgA.",
  "Bc.",
  "doc.",
  "prof.",
] as const;

const suffixTitles = [
  "Ph.D.",
  "Th.D.",
  "LL.M.",
  "DiS.",
  "DrSc.",
  "CSc.",
  "DSc.",
  "MBA",
  "MSc.",
  "MPA",
] as const;

const allTitles = [...prefixTitles, ...suffixTitles].sort(
  (left, right) => right.length - left.length,
);
const prefixTitleByKey = new Map(prefixTitles.map((title) => [titleKey(title), title]));
const suffixTitleByKey = new Map(suffixTitles.map((title) => [titleKey(title), title]));
const lowerCaseParticles = new Set(["de", "van", "von", "der", "da", "di", "la", "le"]);

export function validatePersonName(
  rawInput: string,
  {
    customerType = "private",
    context = "billing",
    policy = "assist",
    allowBlocking = false,
    now = () => new Date(),
  }: PersonNameValidationOptions = {},
): PersonNameValidationResult {
  const checkedAt = now().toISOString();
  const normalization = analyzeNameNormalization(rawInput);
  const normalized = normalization.value;
  const issues: PersonNameIssue[] = [];

  if (!normalized || !/\p{L}/u.test(normalized)) {
    issues.push({
      code: "person.full_name_missing",
      severity: "error",
      message: "The contact name must contain letters.",
    });
    return result("invalid", null, null, issues, checkedAt, context, policy, allowBlocking);
  }

  const invalidCharacters = /[^\p{L}\p{M}\p{White_Space}.'’,-]/u.test(normalized);
  const invalidSeparators = hasInvalidSeparators(normalized);
  const nameParts = substantiveNameParts(normalized);

  if (nameParts.length < 2) {
    issues.push({
      code: "person.full_name_incomplete",
      severity: "error",
      message: "The combined contact field must contain both a given name and a surname.",
    });
  }

  if (customerType === "private" && companyNamePattern.test(normalized)) {
    issues.push({
      code: "person.company_name_in_contact",
      severity: "error",
      message: "A company name was entered for a private customer contact.",
    });
  }

  if (normalization.whitespaceChanged) {
    issues.push({
      code: "person.whitespace_normalized",
      severity: "warning",
      message: "Extra whitespace can be safely removed.",
    });
  }
  if (normalization.trailingPunctuationChanged) {
    issues.push({
      code: "person.trailing_punctuation",
      severity: "warning",
      message: "Stray punctuation can be safely removed from the contact name.",
    });
  }
  if (normalization.titleChanged) {
    issues.push({
      code: "person.title_normalized",
      severity: "warning",
      message: "A known academic or professional title was safely standardized.",
    });
  }
  if (normalization.initialSpacingChanged) {
    issues.push({
      code: "person.initial_spacing_normalized",
      severity: "warning",
      message: "A missing space after a name initial was safely added.",
    });
  }
  if (normalization.capitalizationChanged) {
    issues.push({
      code: "person.capitalization_normalized",
      severity: "warning",
      message: "Unambiguous name capitalization was safely standardized.",
    });
  }
  if (normalization.capitalizationAmbiguous) {
    issues.push({
      code: "person.capitalization_ambiguous",
      severity: "warning",
      message: "Unusual mixed capitalization needs review and was not changed.",
    });
  }
  if (invalidCharacters) {
    issues.push({
      code: "person.invalid_characters",
      severity: "error",
      message: "The contact name contains digits or unsupported symbols.",
    });
  }
  if (invalidSeparators) {
    issues.push({
      code: "person.separator_invalid",
      severity: "error",
      message: "The contact name contains a misplaced or repeated separator.",
    });
  }

  const hasError = issues.some((issue) => issue.severity === "error");
  const changed = normalized !== rawInput;
  const status: ValidationStatus = hasError
    ? "invalid"
    : normalization.capitalizationAmbiguous
      ? "risky"
      : changed
        ? "correctable"
        : "valid";
  const suggestion = status === "correctable" ? normalized : null;
  return result(status, normalized, suggestion, issues, checkedAt, context, policy, allowBlocking);
}

function analyzeNameNormalization(input: string): NameNormalization {
  const nfcInput = input.normalize("NFC");
  const collapsedWhitespace = nfcInput.trim().replace(/\p{White_Space}+/gu, " ");
  const whitespaceChanged = collapsedWhitespace !== input;
  const withoutStrayPunctuation = collapsedWhitespace
    .replace(/\s+([,;:])/g, "$1")
    .replace(/[,;]+$/g, "")
    .trim();
  const trailingPunctuationChanged = withoutStrayPunctuation !== collapsedWhitespace;
  const withTitles = normalizeKnownTitles(withoutStrayPunctuation);
  const titleChanged = withTitles !== withoutStrayPunctuation;
  const withInitialSpacing = normalizeInitialSpacing(withTitles);
  const initialSpacingChanged = withInitialSpacing !== withTitles;
  const casing = normalizeNameCasing(withInitialSpacing);

  return {
    value: casing.value,
    whitespaceChanged,
    trailingPunctuationChanged,
    titleChanged,
    initialSpacingChanged,
    capitalizationChanged: casing.changed,
    capitalizationAmbiguous: casing.ambiguous,
  };
}

function normalizeKnownTitles(input: string): string {
  let normalized = input;
  let previous = "";
  while (normalized !== previous) {
    previous = normalized;
    for (const title of [...prefixTitles].sort((left, right) => right.length - left.length)) {
      const pattern = titlePattern(title);
      normalized = normalized.replace(
        new RegExp(`(^|[\\s,])${pattern}(?=\\p{L})`, "giu"),
        (_match, leading: string) => `${leading}${title} `,
      );
      normalized = normalized.replace(
        new RegExp(`(^|[\\s,])${pattern}(?=\\s|,|$)`, "giu"),
        (_match, leading: string) => `${leading}${title}`,
      );
    }
  }
  for (const title of [...suffixTitles].sort((left, right) => right.length - left.length)) {
    const pattern = titlePattern(title);
    normalized = normalized.replace(
      new RegExp(`([\\p{L}.])([\\s,]+)${pattern}(?=\\s|,|$)`, "giu"),
      (_match, preceding: string, separator: string) => `${preceding}${separator}${title}`,
    );
  }
  return normalized.replace(/\p{White_Space}+/gu, " ").trim();
}

function normalizeInitialSpacing(input: string): string {
  return input.replace(
    /(^|[\s,])((?:\p{L}\.)+)(?=\p{L}{2})/gu,
    (_match, leading: string, initials: string) =>
      `${leading}${initials.replace(/\.(?=\p{L})/gu, ". ")} `,
  );
}

function normalizeNameCasing(input: string): CasingResult {
  let changed = false;
  let ambiguous = false;
  const tokens = input.split(" ");
  const normalizedTokens = tokens.map((token, index) => {
    const trailingComma = token.endsWith(",") ? "," : "";
    const body = trailingComma ? token.slice(0, -1) : token;

    const canonicalTitle =
      (index < tokens.length - 1 ? prefixTitleByKey.get(titleKey(body)) : undefined) ??
      (index > 0 ? suffixTitleByKey.get(titleKey(body)) : undefined);
    if (canonicalTitle) {
      const normalizedTitle = `${canonicalTitle}${trailingComma}`;
      changed ||= normalizedTitle !== token;
      return normalizedTitle;
    }

    if (/^\p{L}\.$/u.test(body)) {
      const normalizedInitial = `${body[0]?.toLocaleUpperCase("cs-CZ") ?? ""}.${trailingComma}`;
      changed ||= normalizedInitial !== token;
      return normalizedInitial;
    }

    if (!/^\p{L}+(?:[-'’]\p{L}+)*$/u.test(body)) return token;

    const particle = body.toLocaleLowerCase("cs-CZ");
    if (index > 0 && lowerCaseParticles.has(particle)) {
      if (body === particle) return token;
      ambiguous = true;
      return token;
    }

    const parts = body.split(/([-’'])/u);
    const normalizedParts = parts.map((part) => {
      if (/^[-’']$/u.test(part)) return part;
      const segment = normalizeNameSegment(part);
      changed ||= segment.changed;
      ambiguous ||= segment.ambiguous;
      return segment.value;
    });
    return `${normalizedParts.join("")}${trailingComma}`;
  });

  return { value: normalizedTokens.join(" "), changed, ambiguous };
}

function normalizeNameSegment(segment: string): CasingResult {
  const lower = segment.toLocaleLowerCase("cs-CZ");
  const upper = segment.toLocaleUpperCase("cs-CZ");
  const titleCased = `${lower.slice(0, 1).toLocaleUpperCase("cs-CZ")}${lower.slice(1)}`;

  if (segment.length === 1 || segment === lower || segment === upper) {
    return { value: titleCased, changed: titleCased !== segment, ambiguous: false };
  }
  if (/^\p{Lu}{2}\p{Ll}+/u.test(segment)) {
    return { value: titleCased, changed: titleCased !== segment, ambiguous: false };
  }
  if (/^\p{Lu}\p{Ll}*$/u.test(segment)) {
    return { value: segment, changed: false, ambiguous: false };
  }
  if (/^(?:Mc|Mac)\p{Lu}\p{Ll}+$/u.test(segment)) {
    return { value: segment, changed: false, ambiguous: false };
  }
  return { value: segment, changed: false, ambiguous: true };
}

function substantiveNameParts(input: string): string[] {
  let withoutTitles = input;
  for (const title of allTitles) {
    withoutTitles = withoutTitles.replace(
      new RegExp(`(^|[\\s,])${titlePattern(title)}(?=\\s|,|$)`, "giu"),
      " ",
    );
  }

  return withoutTitles
    .replace(/,/g, " ")
    .split(/\p{White_Space}+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !lowerCaseParticles.has(part.toLocaleLowerCase("cs-CZ")))
    .filter((part) => /^\p{L}\.$|^\p{L}+(?:[-'’]\p{L}+)*$/u.test(part));
}

function hasInvalidSeparators(input: string): boolean {
  return /[-'’]{2,}|\.{2,}/u.test(input) || /(^|[\s,])[-'’]|[-'’](?=$|[\s,])/u.test(input);
}

function titleKey(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\s.]+/g, "")
    .toLocaleLowerCase("cs-CZ");
}

function titlePattern(title: string): string {
  return title
    .split(/\s+/u)
    .map((part) => escapeRegExp(part))
    .join("\\s*");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function result(
  status: ValidationStatus,
  normalized: string | null,
  suggestion: string | null,
  issues: readonly PersonNameIssue[],
  checkedAt: string,
  context: PersonNameContext,
  policy: Exclude<ValidationPolicy, "custom">,
  allowBlocking: boolean,
): PersonNameValidationResult {
  return {
    status,
    recommended_action: resolveRecommendedAction({ status, policy, allowBlocking }),
    normalized,
    suggestion,
    issues,
    evidence: [
      {
        source: "name_rules",
        checked_at: checkedAt,
        state: status === "invalid" || status === "risky" ? "absent" : "confirmed",
        detail: `context:${context}`,
      },
    ],
  };
}
