/** Self-contained so the same synchronous rule can be included in the hosted browser script. */
export function personNameRequirement(
  input: string,
  part: "full" | "part" = "full",
): string | null {
  let name = input
    .normalize("NFC")
    .trim()
    .replace(/\p{White_Space}+/gu, " ")
    .replace(/[,;]+$/u, "")
    .trim();
  if (!name) return "Doplňte jméno i příjmení, ať se doručení nezpozdí.";
  if (
    /(?:\bs\.?\s*r\.?\s*o\.?\b|\ba\.?\s*s\.?\b|\bspol\.?\s+s\s+r\.?\s*o\.?\b|\bv\.?\s*o\.?\s*s\.?\b|\bdružstvo\b)/iu.test(
      name,
    )
  ) {
    return "Uveďte jméno a příjmení kontaktní osoby.";
  }
  if (
    name.length > 240 ||
    /[^\p{L}\p{M}\p{White_Space}.'’,-]/u.test(name) ||
    /[-'’]{2,}|\.{2,}|(^|[\s,])[-'’]|[-'’](?=$|[\s,])/u.test(name)
  ) {
    return "Zkontrolujte znaky ve jménu a příjmení.";
  }
  const prefix =
    /^(?:(?:Ing\.\s*arch\.|PharmDr\.|MUDr\.|MDDr\.|MVDr\.|JUDr\.|PhDr\.|RNDr\.|ThDr\.|BcA\.|Ing\.|Mgr\.|MgA\.|Bc\.|doc\.|prof\.)\s*)+/iu;
  const suffix = /(?:[\s,]+(?:Ph\.D\.|Th\.D\.|LL\.M\.|DiS\.|DrSc\.|CSc\.|DSc\.|MBA|MSc\.|MPA))+$/iu;
  name = name.replace(prefix, "").replace(suffix, "").trim();
  const parts = name
    .split(/\p{White_Space}+/u)
    .filter((token) => !/^(de|van|von|der|da|di|la|le)$/iu.test(token));
  const complete = parts.filter(
    (token) =>
      /^[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*$/u.test(token) &&
      (token.match(/\p{L}/gu)?.length ?? 0) >= 2,
  );
  if (complete.length !== parts.length || complete.length < (part === "full" ? 2 : 1)) {
    return "Doplňte jméno i příjmení, ať se doručení nezpozdí.";
  }
  return null;
}
