import { intlLocale, t } from "../i18n";
import { checkoutOutcome } from "./checkout-outcome";

export { checkoutOutcome } from "./checkout-outcome";
export interface CaseCheckout {
  session_ref: string;
  form_id: string;
  source: string;
  started_at: string;
  last_seen_at: string;
  attempts: number;
  blocks: number;
  purchase_reported: boolean;
  events: {
    event_id: string;
    event: string;
    reason: string;
    field: string;
    context: string;
    at: string;
  }[];
}
const labels: Record<string, string> = {
  started: t("Začal vyplňovat", "Started filling in"),
  activity: t("Vyplňování", "Filling in"),
  submit_attempt: t("Pokus objednat", "Order attempt"),
  blocked: t("Zachycená validace / odeslání", "Validation / submit caught"),
  submit_dispatched: t("Odeslání vyvoláno", "Submit triggered"),
  page_left: t("Odchod ze stránky", "Left the page"),
  purchase_reported: t("Objednávka hlášena prohlížečem", "Order reported by the browser"),
  checkdrop_name: t("chybí celé jméno", "full name missing"),
  checkdrop_foreign_address: t("adresa nevypadá jako česká", "address does not look Czech"),
  native_required: t("chybí povinné pole", "required field missing"),
  native_format: t("neplatný formát", "invalid format"),
  shop_validation: t("validace e-shopu", "shop validation"),
  shop_cancelled: t(
    "odeslání převzal e-shop; může jít o AJAX",
    "the shop took over the submit; may be AJAX",
  ),
  full_name: t("jméno", "name"),
  email: t("e-mail", "email"),
  phone: t("telefon", "phone"),
  street_line: t("ulice", "street"),
  city: t("město", "city"),
  postal_code: "PSČ",
  billing: t("fakturační", "billing"),
  shipping: t("doručovací", "shipping"),
};
export function CaseCheckoutDetail({ rows }: { rows: CaseCheckout[] }) {
  const attempts = rows.reduce((n, r) => n + r.attempts, 0);
  const blocks = rows.reduce((n, r) => n + r.blocks, 0);
  const events = rows.flatMap((r) => r.events).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return (
    <section
      className="case-checkout"
      aria-label={t("Průchod tohoto košíku", "Progress of this checkout")}
    >
      <strong>{checkoutOutcome(rows)}</strong>
      <p>
        {rows.length
          ? t(
              `${attempts} pokusů objednat · ${blocks} zachycených kontrol při odeslání`,
              `${attempts} order ${attempts === 1 ? "attempt" : "attempts"} · ${blocks} ${blocks === 1 ? "check" : "checks"} caught on submit`,
            )
          : t(
              "Pro tento případ nejsou dostupné události košíku.",
              "No checkout events are available for this case.",
            )}
      </p>
      <details className="case-measurement-help">
        <summary>
          {t(
            "Jak číst výsledek a zachycené hodnoty",
            "How to read the outcome and captured values",
          )}
        </summary>
        <p>
          {t(
            "Objednávka je hlášená prohlížečem, nikoli potvrzená platba. Pravděpodobné opuštění znamená 30 minut bez aktivity a bez potvrzení; není důkazem neúspěšné objednávky. Hodnoty pocházejí z kontrol, ne z přesné kopie formuláře při odchodu. Neodeslané změny neznáme.",
            "The order is reported by the browser, not a confirmed payment. Probably abandoned means 30 minutes without activity and without confirmation; it does not prove the order failed. Values come from checks, not from an exact copy of the form when the visitor left. Changes that were not submitted are unknown.",
          )}
        </p>
      </details>
      {events.length > 0 && (
        <ol>
          {events.map((e) => (
            <li key={e.event_id}>
              <time>{new Date(e.at).toLocaleString(intlLocale)}</time>
              <span>
                {labels[e.event] ?? e.event}
                {e.reason !== "none" ? `: ${labels[e.reason] ?? e.reason}` : ""}
              </span>
              <span className="case-event-field">
                {e.field !== "none"
                  ? ` · ${labels[e.field] ?? e.field} (${labels[e.context] ?? e.context})`
                  : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
