export const validationStatuses = ["valid", "correctable", "risky", "invalid", "unknown"] as const;

export type ValidationStatus = (typeof validationStatuses)[number];

export const recommendedActions = [
  "accept",
  "normalize",
  "suggest",
  "warn",
  "block",
  "defer",
  "fail_open",
] as const;

export type RecommendedAction = (typeof recommendedActions)[number];

export const validationPolicies = ["assist", "standard", "strict", "custom"] as const;

export type ValidationPolicy = (typeof validationPolicies)[number];

export const CHECKDROP_CORE_VERSION = "0.1.0-dev.0";

export interface PolicyInput {
  readonly status: ValidationStatus;
  readonly policy: Exclude<ValidationPolicy, "custom">;
  readonly allowBlocking?: boolean;
}

/**
 * Maps evidence status to a safe default client action.
 * Validation determines facts; policy determines whether those facts may block a caller.
 */
export function resolveRecommendedAction({
  status,
  policy,
  allowBlocking = false,
}: PolicyInput): RecommendedAction {
  if (status === "valid") {
    return "accept";
  }

  if (status === "correctable") {
    return "suggest";
  }

  if (status === "risky") {
    return "warn";
  }

  if (status === "unknown") {
    return "fail_open";
  }

  if (policy !== "assist" && allowBlocking) {
    return "block";
  }

  return "warn";
}

export * from "./country-pack.js";
export * from "./email.js";
export * from "./email-rules.js";
export * from "./email-suggestion.js";
export * from "./name-requirement.js";
export type * from "./operator-contracts.js";
export * from "./person-name.js";
export * from "./phone-requirement.js";
export * from "./provider.js";
