import { CheckCircleIcon, ClockIcon, QuestionIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { t } from "../i18n";
import type { CaseCheckout } from "./case-checkout";
import { checkoutOutcome, checkoutOutcomeKind } from "./checkout-outcome";
export default function CheckoutOutcomeIcon({
  rows,
  unavailable,
}: {
  rows: CaseCheckout[];
  unavailable: boolean;
}) {
  const outcome = checkoutOutcome(rows);
  const complete = rows.some((row) => row.purchase_reported);
  const abandoned = checkoutOutcomeKind(rows) === "abandoned";
  const unknown = unavailable || !rows.length;
  const Icon = unknown
    ? QuestionIcon
    : complete
      ? CheckCircleIcon
      : abandoned
        ? WarningCircleIcon
        : ClockIcon;
  const label = unavailable
    ? t("Stav nyní nelze načíst", "The state cannot be loaded now")
    : outcome;
  const info = unknown
    ? t(
        "Nemáme dostupné měření výsledku tohoto košíku.",
        "No outcome measurement is available for this checkout.",
      )
    : complete
      ? t(
          "E-shop v prohlížeči ohlásil vytvoření objednávky. Neznamená to potvrzenou platbu.",
          "The shop reported an order in the browser. This is not a confirmed payment.",
        )
      : abandoned
        ? t(
            "Nejméně 30 minut bez aktivity a bez potvrzení objednávky. Opuštění není jisté.",
            "At least 30 minutes without activity or a confirmed order. Abandonment is not certain.",
          )
        : t(
            "Zákazník pracoval s košíkem. Potvrzení objednávky zatím nemáme.",
            "The customer worked on the checkout. No order confirmation yet.",
          );
  return (
    <span
      className={`checkout-outcome-icon ${unknown ? "unknown" : complete ? "complete" : abandoned ? "abandoned" : "active"}`}
      role="img"
      aria-label={`${label}. ${info} ${t("Rozbalte případ pro průběh.", "Expand the case for its timeline.")}`}
    >
      <Icon size={20} aria-hidden="true" />
      <span className="checkout-outcome-tooltip" aria-hidden="true">
        <strong>{label}</strong>
        {info}
      </span>
    </span>
  );
}
