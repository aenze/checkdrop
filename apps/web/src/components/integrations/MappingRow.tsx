import { CaretDownIcon as CaretDown, TrashIcon as Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { t } from "../../i18n";
import {
  type CanonicalField,
  contextOptions,
  type FieldContext,
  fieldOptions,
  type IntegrationField,
  modeOptions,
  triggerOptions,
  type ValidationMode,
  type ValidationTrigger,
} from "./model";
export function MappingRow({
  field,
  onChange,
  onRemove,
}: {
  readonly field: IntegrationField;
  readonly onChange: (patch: Partial<IntegrationField>) => void;
  readonly onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ignored = field.validation_mode === "off";
  const suggestableFields = new Set<CanonicalField>([
    "full_name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "street_line",
    "company_name",
    "company_id",
  ]);
  const availableModeOptions = modeOptions
    .filter((option) => option.value !== "suggest" || suggestableFields.has(field.canonical_field))
    .map((option) => {
      if (option.value === "shadow" && field.require_complete_name)
        return { ...option, label: t("Vyžadovat celé jméno", "Require full name") };
      if (option.value !== "suggest") return option;
      if (field.canonical_field === "phone") {
        return {
          ...option,
          label: t("Automaticky formátovat", "Format automatically"),
          note: t("bezpečný český formát bez upozornění", "safe Czech format without a warning"),
        };
      }
      if (["street_line", "company_name", "company_id"].includes(field.canonical_field)) {
        return {
          ...option,
          label:
            field.canonical_field === "street_line"
              ? t("Nabízet adresy", "Suggest addresses")
              : t("Doplňovat z ARES", "Fill in from ARES"),
          note:
            field.canonical_field === "street_line"
              ? t(
                  "výběr z RÚIAN doplní také město a PSČ",
                  "picking from RÚIAN also fills in city and PSČ",
                )
              : t(
                  "výběr firmy doplní IČO, DIČ a fakturační sídlo; vše lze vrátit",
                  "picking a company fills in IČO, DIČ and the billing address; all can be undone",
                ),
        };
      }
      if (["full_name", "first_name", "last_name"].includes(field.canonical_field)) {
        return {
          ...option,
          label: t("Upozornit a nabídnout opravu", "Warn and suggest a fix"),
          note: t(
            "vyžádá celé jméno; bezpečnou úpravu zákazník potvrdí",
            "asks for the full name; the customer confirms a safe adjustment",
          ),
        };
      }
      return option;
    });
  const modeNote = field.require_complete_name
    ? t(
        "Neúplné osobní jméno zabrání dokončení formuláře, dokud je náš skript načtený.",
        "An incomplete personal name stops the form from completing while our script is loaded.",
      )
    : field.require_domestic_address
      ? t(
          "Zahraniční adresu ukážeme zákazníkovi a první dokončení jednou zastavíme.",
          "We show a foreign address to the customer and stop the first completion once.",
        )
      : field.require_valid_phone
        ? t(
            "Prázdný nebo neplatný telefon zabrání dokončení formuláře, dokud je náš skript načtený.",
            "An empty or invalid phone number stops the form from completing while our script is loaded.",
          )
        : availableModeOptions.find((option) => option.value === field.validation_mode)?.note;
  return (
    <li className={`mapping-card ${ignored ? "ignored" : ""}`}>
      <details
        className="mapping-row-editor"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <strong>{field.label || t("Nepojmenované pole", "Unnamed field")}</strong>
          <span>
            {field.require_complete_name
              ? t("Povinné celé jméno", "Full name required")
              : field.require_domestic_address
                ? t("Doručení jen v ČR", "Delivery only in Czechia")
                : field.require_valid_phone
                  ? t("Povinný platný telefon", "Valid phone required")
                  : availableModeOptions.find((option) => option.value === field.validation_mode)
                      ?.label}
          </span>
          <CaretDown className="mapping-expand-icon" size={14} aria-hidden="true" />
        </summary>
        <div className="mapping-card-main">
          <div className="mapping-source">
            <strong>{field.label || t("Nepojmenované pole", "Unnamed field")}</strong>
            <code>{field.selector || t("Selektor zatím chybí", "Selector missing")}</code>
            <small>
              {field.detected
                ? t(
                    `Nalezeno · jistota ${field.confidence ?? 0} %`,
                    `Found · ${field.confidence ?? 0}% confidence`,
                  )
                : t("Přidáno ručně", "Added manually")}
            </small>
          </div>
          <div className="mapping-control">
            <span>{t("Význam", "Meaning")}</span>
            <Select
              value={field.canonical_field}
              label={t(`Význam pole ${field.label}`, `Meaning of field ${field.label}`)}
              options={fieldOptions}
              onChange={(value) =>
                onChange({
                  canonical_field: value as CanonicalField,
                  require_complete_name: ["full_name", "first_name", "last_name"].includes(value)
                    ? field.require_complete_name
                    : false,
                  require_domestic_address:
                    value === "postal_code" ? field.require_domestic_address : false,
                  require_valid_phone: value === "phone" ? field.require_valid_phone : false,
                  fill_village_street: value === "street_line" ? field.fill_village_street : false,
                  validation_mode:
                    value === "unmapped"
                      ? "off"
                      : !suggestableFields.has(value as CanonicalField) &&
                          field.validation_mode === "suggest"
                        ? "shadow"
                        : field.validation_mode,
                })
              }
            />
          </div>
          <div className="mapping-control">
            <span>{t("Část objednávky", "Part of order")}</span>
            <Select
              value={field.context}
              label={t(`Část objednávky pro ${field.label}`, `Part of order for ${field.label}`)}
              options={contextOptions}
              onChange={(value) => onChange({ context: value as FieldContext })}
            />
          </div>
          <div className="mapping-control">
            <span>{t("Kontrola", "Check")}</span>
            <Select
              value={field.validation_mode}
              label={t(`Způsob kontroly pro ${field.label}`, `Check type for ${field.label}`)}
              options={availableModeOptions.map(({ value, label }) => ({ value, label }))}
              onChange={(value) =>
                onChange({
                  validation_mode: value as ValidationMode,
                  require_complete_name: value === "off" ? false : field.require_complete_name,
                  require_domestic_address:
                    value === "off" ? false : field.require_domestic_address,
                  require_valid_phone: value === "off" ? false : field.require_valid_phone,
                  fill_village_street: value === "suggest" ? field.fill_village_street : false,
                  validation_trigger:
                    value === "suggest"
                      ? ["street_line", "company_name", "company_id"].includes(
                          field.canonical_field,
                        )
                        ? "input"
                        : "blur"
                      : field.validation_trigger,
                })
              }
            />
            <small>{modeNote}</small>
          </div>
        </div>
        <details className="mapping-advanced">
          <summary>{t("Pokročilé nastavení", "Advanced settings")}</summary>
          <div className="mapping-advanced-grid">
            <label>
              <span>{t("Název pole", "Field name")}</span>
              <input
                aria-label={t(`Název pole ${field.label}`, `Name of field ${field.label}`)}
                value={field.label}
                onChange={(e) => onChange({ label: e.currentTarget.value })}
              />
            </label>
            <label>
              <span>{t("CSS selektor", "CSS selector")}</span>
              <input
                className="mapping-selector"
                aria-label={t(
                  `CSS selektor pole ${field.label}`,
                  `CSS selector of field ${field.label}`,
                )}
                value={field.selector}
                onChange={(e) => onChange({ selector: e.currentTarget.value })}
                placeholder={t("#id nebo [name='field']", "#id or [name='field']")}
              />
            </label>
            <div className="mapping-advanced-control">
              <span>{t("Kdy zkontrolovat", "When to check")}</span>
              <Select
                value={field.validation_trigger}
                label={t(`Okamžik kontroly pro ${field.label}`, `Check timing for ${field.label}`)}
                options={triggerOptions}
                onChange={(value) => onChange({ validation_trigger: value as ValidationTrigger })}
                disabled={ignored}
              />
            </div>
            <label>
              <span>{t("Podmínka", "Condition")}</span>
              <select
                aria-label={t(
                  `Podmínka kontroly pro ${field.label}`,
                  `Check condition for ${field.label}`,
                )}
                value={field.condition_key ?? ""}
                onChange={(event) => onChange({ condition_key: event.currentTarget.value || null })}
                disabled={ignored}
              >
                <option value="">{t("Vždy", "Always")}</option>
                <option value="customer_type=private">{t("Jen soukromě", "Private only")}</option>
                <option value="customer_type=company">{t("Jen na firmu", "Company only")}</option>
                <option value="profile_details_enabled=true">
                  {t("Po rozbalení všech údajů", "After expanding all details")}
                </option>
                <option value="alternate_shipping_enabled=true">
                  {t("Při jiné doručovací adrese", "With a different delivery address")}
                </option>
                <option value="profile_details_enabled=true&customer_type=company">
                  {t("Po rozbalení a jen na firmu", "After expanding, company only")}
                </option>
              </select>
            </label>
            <label className="required-control">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) => onChange({ required: event.currentTarget.checked })}
              />
              <span>{t("Kontrolovat i prázdnou hodnotu", "Check empty values too")}</span>
            </label>
            {["full_name", "first_name", "last_name"].includes(field.canonical_field) && (
              <>
                <label className="required-control">
                  <input
                    type="checkbox"
                    checked={field.require_complete_name ?? false}
                    disabled={ignored}
                    onChange={(event) =>
                      onChange({ require_complete_name: event.currentTarget.checked })
                    }
                  />
                  <span>
                    {t(
                      "Vyžadovat jméno i příjmení před odesláním",
                      "Require first and last name before submitting",
                    )}
                  </span>
                </label>
                {field.require_complete_name && (
                  <label>
                    <span>
                      {t(
                        "Tlačítko dokončení (volitelný CSS selektor)",
                        "Completion button (optional CSS selector)",
                      )}
                    </span>
                    <input
                      value={field.submit_selector ?? ""}
                      placeholder={t("Např. .order-submit", "E.g. .order-submit")}
                      maxLength={512}
                      onChange={(event) =>
                        onChange({ submit_selector: event.currentTarget.value.trim() || null })
                      }
                    />
                    <small>
                      {t(
                        "Pro AJAX nebo formulář s více tlačítky. Prázdné = běžné odeslání formuláře.",
                        "For AJAX or a form with several buttons. Empty = normal form submit.",
                      )}
                    </small>
                  </label>
                )}
              </>
            )}
            {field.canonical_field === "postal_code" && (
              <>
                <label className="required-control">
                  <input
                    type="checkbox"
                    checked={field.require_domestic_address ?? false}
                    disabled={ignored}
                    onChange={(event) =>
                      onChange({ require_domestic_address: event.currentTarget.checked })
                    }
                  />
                  <span>
                    {t(
                      "Doručujeme jen v ČR: upozornit na zahraniční adresu",
                      "We deliver only in Czechia: warn about a foreign address",
                    )}
                  </span>
                </label>
                {field.require_domestic_address && (
                  <label>
                    <span>
                      {t(
                        "Tlačítko dokončení (volitelný CSS selektor)",
                        "Completion button (optional CSS selector)",
                      )}
                    </span>
                    <input
                      value={field.submit_selector ?? ""}
                      placeholder={t("Např. .order-submit", "E.g. .order-submit")}
                      maxLength={512}
                      onChange={(event) =>
                        onChange({ submit_selector: event.currentTarget.value.trim() || null })
                      }
                    />
                    <small>
                      {t(
                        "Slovenské PSČ nebo město zastaví první dokončení jednou, druhé už projde.",
                        "A Slovak PSČ or city stops the first completion once; the second goes through.",
                      )}
                    </small>
                  </label>
                )}
              </>
            )}
            {field.canonical_field === "phone" && (
              <>
                <label className="required-control">
                  <input
                    type="checkbox"
                    checked={field.require_valid_phone ?? false}
                    disabled={ignored}
                    onChange={(event) =>
                      onChange({ require_valid_phone: event.currentTarget.checked })
                    }
                  />
                  <span>
                    {t(
                      "Vyžadovat platný telefon před odesláním",
                      "Require a valid phone number before submitting",
                    )}
                  </span>
                </label>
                {field.require_valid_phone && (
                  <label>
                    <span>
                      {t(
                        "Tlačítko dokončení (volitelný CSS selektor)",
                        "Completion button (optional CSS selector)",
                      )}
                    </span>
                    <input
                      value={field.submit_selector ?? ""}
                      placeholder={t("Např. .order-submit", "E.g. .order-submit")}
                      maxLength={512}
                      onChange={(event) =>
                        onChange({ submit_selector: event.currentTarget.value.trim() || null })
                      }
                    />
                    <small>
                      {t(
                        "Prázdné pole, e-mail nebo neúplné číslo zastaví dokončení. Platné číslo projde i bez formátování.",
                        "An empty field, an e-mail or an incomplete number stops completion. A valid number passes even unformatted.",
                      )}
                    </small>
                  </label>
                )}
              </>
            )}
            {field.canonical_field === "street_line" && field.validation_mode === "suggest" && (
              <label className="required-control">
                <input
                  type="checkbox"
                  checked={field.fill_village_street ?? false}
                  disabled={ignored}
                  onChange={(event) =>
                    onChange({ fill_village_street: event.currentTarget.checked })
                  }
                />
                <span>
                  {t(
                    "Doplňovat obec u adres bez ulic (242 → Sudoměřice 242)",
                    "Add the village to addresses without streets (242 → Sudoměřice 242)",
                  )}
                </span>
              </label>
            )}
            <button
              className="quiet-button danger-text"
              type="button"
              aria-label={t(`Odstranit pole ${field.label}`, `Remove field ${field.label}`)}
              onClick={onRemove}
            >
              <Trash size={15} /> {t("Odstranit pole", "Remove field")}
            </button>
          </div>
        </details>
      </details>
    </li>
  );
}

export function Select({
  value,
  label,
  options,
  onChange,
  disabled = false,
}: {
  readonly value: string;
  readonly label: string;
  readonly options: readonly { value: string; label: string }[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
