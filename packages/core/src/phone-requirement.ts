/**
 * Why a phone number cannot be used for delivery, or null when it can.
 *
 * Self-contained so the same synchronous rule can be included in the hosted browser script. It
 * only reads the typed value: it never waits for the API, and it accepts every number that is
 * merely unformatted (spaces, dashes, brackets, a missing +420). A Czech or Slovak number needs
 * nine national digits; a foreign number written with its dialling code is accepted by length.
 */
export function phoneRequirement(
  input: string,
): "phone.required" | "phone.email" | "phone.invalid" | null {
  const value = input
    .normalize("NFKC")
    .replace(/\p{White_Space}+/gu, " ")
    .trim();
  // An untouched "+420 " prefill counts as empty.
  if (!value || /^\+(?:4(?:2(?:0)?)?)?$/.test(value)) return "phone.required";
  if (value.includes("@")) return "phone.email";
  // Only a leading plus, optionally inside a bracket as in "(+420) 777 123 456".
  if (value.length > 40 || !/^\(?\+?[\d ()./-]+$/.test(value)) return "phone.invalid";
  const digits = value.replace(/\D/g, "");
  const plus = /^\(?\+/.test(value);
  const international = plus || digits.startsWith("00");
  const number = plus ? digits : digits.startsWith("00") ? digits.slice(2) : "";
  if (international) {
    if (number.startsWith("420") || number.startsWith("421")) {
      return number.length === 12 ? null : "phone.invalid";
    }
    // E.164 allows up to 15 digits; the shortest numbering plans in use have seven.
    return /^[1-9]\d{6,14}$/.test(number) ? null : "phone.invalid";
  }
  // Without a dialling code: a Czech or Slovak number without the trunk 0, a Slovak number with
  // it (0905 123 456), or a 420/421 dialling code typed without the plus.
  if (digits.length === 9 && /^[1-9]/.test(digits)) return null;
  if (digits.length === 10 && /^0[1-9]/.test(digits)) return null;
  if (digits.length === 12 && /^42[01]/.test(digits)) return null;
  return "phone.invalid";
}
