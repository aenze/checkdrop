import { t } from "../i18n";

export type CheckoutOutcomeKind = "unmeasured" | "completed" | "abandoned" | "active";

/** Outcome of a checkout independent of the interface language, for icons and styling. */
export function checkoutOutcomeKind(
  rows: { purchase_reported: boolean; last_seen_at: string }[],
  now = Date.now(),
): CheckoutOutcomeKind {
  if (!rows.length) return "unmeasured";
  if (rows.some((r) => r.purchase_reported)) return "completed";
  const last = Math.max(...rows.map((r) => Date.parse(r.last_seen_at)));
  return now - last >= 30 * 60000 ? "abandoned" : "active";
}

export function checkoutOutcome(
  rows: { purchase_reported: boolean; last_seen_at: string }[],
  now = Date.now(),
): string {
  const kind = checkoutOutcomeKind(rows, now);
  if (kind === "unmeasured") return t("Výsledek neměřen", "Outcome not measured");
  if (kind === "completed") return t("Dokončení zachyceno", "Completion recorded");
  return kind === "abandoned"
    ? t("Pravděpodobně opuštěný", "Probably abandoned")
    : t("Rozpracovaný košík", "Checkout in progress");
}
