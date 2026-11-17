import { type PhoneValidation, resolveRecommendedAction } from "@checkdrop/core";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export function validateCzechPhone(input: string): PhoneValidation {
  const parsed = parsePhoneNumberFromString(input, "CZ");
  if (parsed?.country && parsed.country !== "CZ") {
    return result("risky", parsed.number, ["phone.country_not_cz"]);
  }

  let nationalDigits = input.replace(/\D/g, "");
  if (nationalDigits.startsWith("00420")) nationalDigits = nationalDigits.slice(5);
  else if (nationalDigits.startsWith("420")) nationalDigits = nationalDigits.slice(3);

  if (nationalDigits.length !== 9 || !parsed?.isPossible() || parsed.country !== "CZ") {
    return result("invalid", null, ["phone.number_impossible"]);
  }

  const compactInput = input.replace(/[\s()-]/g, "");
  const status = compactInput === parsed.number ? "valid" : "correctable";
  return result(status, parsed.number, status === "correctable" ? ["phone.normalized"] : []);
}

function result(
  status: PhoneValidation["status"],
  normalized: string | null,
  issues: readonly string[],
): PhoneValidation {
  return {
    status,
    recommended_action: resolveRecommendedAction({
      status,
      policy: "assist",
    }) as PhoneValidation["recommended_action"],
    normalized,
    issues,
  };
}
