import type {
  CanonicalField,
  FieldContext,
  Integration,
  IntegrationField,
  IntegrationFormProfile,
  IntegrationState,
  ValidationMode,
  ValidationTrigger,
} from "@checkdrop/core";
import { intlLocale, t } from "../../i18n";

export type {
  ApiKeySummary,
  CanonicalField,
  ConfigVersion,
  Environment,
  FieldContext,
  FormScan,
  Integration,
  IntegrationField,
  IntegrationFormProfile,
  IntegrationFormState,
  IntegrationState,
  MatchMode,
  ValidationMode,
  ValidationTrigger,
} from "@checkdrop/core";
export const fieldOptions: readonly { value: CanonicalField; label: string }[] = [
  { value: "customer_type", label: t("Soukromě / na firmu", "Private / company") },
  { value: "full_name", label: t("Jméno a příjmení", "Full name") },
  { value: "first_name", label: t("Jméno", "First name") },
  { value: "last_name", label: t("Příjmení", "Last name") },
  { value: "email", label: t("E-mail", "Email") },
  { value: "phone", label: t("Telefon", "Phone") },
  { value: "street_line", label: t("Ulice a číslo", "Street and number") },
  { value: "city", label: t("Město", "City") },
  { value: "postal_code", label: "PSČ" },
  { value: "country", label: t("Země", "Country") },
  { value: "company_id", label: "IČO" },
  { value: "company_name", label: t("Název firmy", "Company name") },
  { value: "vat_id", label: "DIČ" },
  { value: "profile_details_enabled", label: t("Rozbalení dalších údajů", "Expand more details") },
  {
    value: "alternate_shipping_enabled",
    label: t("Jiná doručovací adresa", "Different delivery address"),
  },
  { value: "unmapped", label: t("Nezařazeno", "Unassigned") },
];

export const contextOptions: readonly { value: FieldContext; label: string }[] = [
  { value: "billing", label: t("Fakturační", "Billing") },
  { value: "shipping", label: t("Doručovací", "Delivery") },
  { value: "company", label: t("Firemní", "Company") },
  { value: "shared", label: t("Společné", "Shared") },
];

export const modeOptions: readonly { value: ValidationMode; label: string; note: string }[] = [
  {
    value: "off",
    label: t("Nevalidovat", "Do not validate"),
    note: t("pole se neposílá", "the field is not sent"),
  },
  {
    value: "shadow",
    label: t("Jen sledovat", "Monitor only"),
    note: t("bez zásahu", "no intervention"),
  },
  {
    value: "suggest",
    label: t("Nabídnout opravu", "Suggest a fix"),
    note: t(
      "zákazník ji musí potvrdit; objednávka se neblokuje",
      "the customer must confirm it; the order is not blocked",
    ),
  },
];

export const triggerOptions: readonly { value: ValidationTrigger; label: string }[] = [
  { value: "input", label: t("Při psaní", "While typing") },
  { value: "blur", label: t("Po opuštění pole", "On leaving the field") },
  { value: "submit", label: t("Při odeslání", "On submit") },
];

export const stateLabels: Record<IntegrationState, string> = {
  draft: t("Rozpracováno", "Draft"),
  scanned: t("Pole nalezena", "Fields found"),
  configured: t("Nastaveno", "Configured"),
  shadow: t("Čeká na data", "Waiting for data"),
  paused: t("Pozastaveno", "Paused"),
};

export const executableCanonicalFields = new Set<CanonicalField>([
  "full_name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "street_line",
  "company_id",
  "company_name",
]);

export function isExecutableField(field: IntegrationField) {
  return field.validation_mode !== "off" && executableCanonicalFields.has(field.canonical_field);
}

export function runtimeLabel(integration: Integration) {
  if (integration.state === "paused") return t("Pozastaveno", "Paused");
  if (integration.state === "shadow" && (integration.activity?.observation_count_24h ?? 0) > 0) {
    return t("Data přijímáme", "Receiving data");
  }
  if (integration.state === "shadow" && integration.activity?.last_key_used_at) {
    return t("Připojeno, čeká na kontrolu", "Connected, waiting for a check");
  }
  return stateLabels[integration.state];
}

export function runtimeTone(integration: Integration) {
  if (integration.state === "shadow" && (integration.activity?.observation_count_24h ?? 0) > 0) {
    return "verified";
  }
  if (integration.state === "shadow") return "waiting";
  return integration.state;
}

export function defaultForm(integration: Integration): IntegrationFormProfile | null {
  return integration.forms.find((form) => form.is_default) ?? integration.forms[0] ?? null;
}

export function validateFields(fields: readonly IntegrationField[]) {
  const missingSelector = fields.find((field) => !field.selector.trim());
  if (missingSelector) {
    return t(
      "Každé pole potřebuje CSS selektor, například #billing-name.",
      "Every field needs a CSS selector, for example #billing-name.",
    );
  }
  const selectorKeys = new Set<string>();
  const canonicalKeys = new Set<string>();
  const customerTypeActive = fields.some(
    (field) => field.canonical_field === "customer_type" && field.validation_mode === "shadow",
  );
  const profileDetailsActive = fields.some(
    (field) =>
      field.canonical_field === "profile_details_enabled" && field.validation_mode === "shadow",
  );
  const alternateShippingActive = fields.some(
    (field) =>
      field.canonical_field === "alternate_shipping_enabled" && field.validation_mode === "shadow",
  );
  for (const field of fields) {
    const selectorKey = `${field.context}:${field.selector.trim()}`;
    if (selectorKeys.has(selectorKey)) {
      return t(
        `Selektor ${field.selector} je ve stejné části objednávky použit vícekrát.`,
        `The selector ${field.selector} is used more than once in the same part of the order.`,
      );
    }
    selectorKeys.add(selectorKey);
    if (isExecutableField(field)) {
      const canonicalKey = `${field.context}:${field.canonical_field}`;
      if (canonicalKeys.has(canonicalKey)) {
        const meaning =
          fieldOptions.find((option) => option.value === field.canonical_field)?.label ??
          field.canonical_field;
        return t(
          `Význam „${meaning}“ je ve stejné části objednávky přiřazen vícekrát.`,
          `The meaning “${meaning}” is assigned more than once in the same part of the order.`,
        );
      }
      canonicalKeys.add(canonicalKey);
    }
    if (field.condition_key?.includes("customer_type=") && !customerTypeActive) {
      return t(
        "Podmínka Soukromě / na firmu vyžaduje, aby se stejnojmenné pole také sledovalo.",
        "The Private / company condition needs the field of the same name to be monitored too.",
      );
    }
    if (field.condition_key?.includes("profile_details_enabled=true") && !profileDetailsActive) {
      return t(
        "Podmínka rozbalených údajů vyžaduje namapovanou volbu Chci vyplnit všechny údaje.",
        "The expanded details condition needs the “I want to fill in all details” option mapped.",
      );
    }
    if (
      field.condition_key?.includes("alternate_shipping_enabled=true") &&
      !alternateShippingActive
    ) {
      return t(
        "Doručovací podmínka vyžaduje namapovanou volbu Doručit na jinou adresu.",
        "The delivery condition needs the “Deliver to a different address” option mapped.",
      );
    }
    if (field.validation_mode === "suggest") {
      const blurAssist = ["full_name", "first_name", "last_name", "email", "phone"].includes(
        field.canonical_field,
      );
      const addressAssist = field.canonical_field === "street_line";
      const companyAssist = ["company_name", "company_id"].includes(field.canonical_field);
      if (!blurAssist && !addressAssist && !companyAssist) {
        return t(
          "Asistenci lze zapnout pro jméno, firmu, IČO, e-mail, telefon a ulici.",
          "Assistance can be turned on for name, company, IČO, email, phone and street.",
        );
      }
      if (blurAssist && field.validation_trigger !== "blur") {
        return t(
          "Asistence jména, e-mailu a telefonu proběhne po opuštění pole.",
          "Name, email and phone assistance runs when the visitor leaves the field.",
        );
      }
      if ((addressAssist || companyAssist) && field.validation_trigger !== "input") {
        return t(
          "Adresní a firemní návrhy se zobrazují průběžně při psaní.",
          "Address and company suggestions appear while typing.",
        );
      }
    }
  }
  for (const address of fields.filter(
    (field) => field.canonical_field === "street_line" && field.validation_mode !== "off",
  )) {
    const supporting = new Set(
      fields
        .filter((field) => field.context === address.context && field.validation_mode === "shadow")
        .map((field) => field.canonical_field),
    );
    if (
      !["city", "postal_code", "country"].every((field) => supporting.has(field as CanonicalField))
    ) {
      return t(
        "Kontrola adresy potřebuje ve stejné části objednávky také město, PSČ a zemi.",
        "The address check also needs city, PSČ and country in the same part of the order.",
      );
    }
  }
  return null;
}

export function clientIdentifier(name: string, url: string) {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const candidate = `${host || name}-forms`
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 64);
  return /[a-z]/.test(candidate) ? candidate : "website-forms";
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formCountLabel(count: number) {
  return t(
    `${count} ${czechPlural(count, "formulář", "formuláře", "formulářů")}`,
    `${count} ${count === 1 ? "form" : "forms"}`,
  );
}

export function observationCountLabel(count: number) {
  return t(
    `${count} ${czechPlural(count, "kontrola", "kontroly", "kontrol")}`,
    `${count} ${count === 1 ? "check" : "checks"}`,
  );
}

export function assistCountLabel(count: number) {
  return t(
    `${count} ${czechPlural(count, "pole s nápovědou", "pole s nápovědou", "polí s nápovědou")}`,
    `${count} ${count === 1 ? "field" : "fields"} with assistance`,
  );
}

export function czechPlural(count: number, one: string, few: string, many: string) {
  return count === 1 ? one : count >= 2 && count <= 4 ? few : many;
}

export function fieldRequest(field: IntegrationField) {
  return {
    selector: field.selector,
    label: field.label,
    name: field.name,
    canonical_field: field.canonical_field,
    context: field.context,
    condition_key: field.condition_key,
    required: field.required,
    require_complete_name: field.require_complete_name ?? false,
    require_domestic_address: field.require_domestic_address ?? false,
    require_valid_phone: field.require_valid_phone ?? false,
    fill_village_street: field.fill_village_street ?? false,
    submit_selector: field.submit_selector ?? null,
    validation_mode: field.validation_mode,
    validation_trigger: field.validation_trigger,
    confidence: field.confidence,
    detected: field.detected,
  };
}

/** What the saved mapping does to a customer's checkout, as shown in "Saved configuration behaviour". */
export function assistanceSummary(fields: readonly IntegrationField[]) {
  const assistableFields = new Set<CanonicalField>([
    "full_name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "street_line",
    "company_name",
    "company_id",
  ]);
  const assistedFieldCount = fields.filter(
    (field) => assistableFields.has(field.canonical_field) && field.validation_mode === "suggest",
  ).length;
  const assistedNameCount = fields.filter(
    (field) =>
      ["full_name", "first_name", "last_name"].includes(field.canonical_field) &&
      field.validation_mode === "suggest",
  ).length;
  const assistedEmailCount = fields.filter(
    (field) => field.canonical_field === "email" && field.validation_mode === "suggest",
  ).length;
  const automaticPhoneCount = fields.filter(
    (field) => field.canonical_field === "phone" && field.validation_mode === "suggest",
  ).length;
  const assistedAddressCount = fields.filter(
    (field) => field.canonical_field === "street_line" && field.validation_mode === "suggest",
  ).length;
  const villageStreetCount = fields.filter(
    (field) =>
      field.canonical_field === "street_line" &&
      field.validation_mode === "suggest" &&
      field.fill_village_street,
  ).length;
  const assistedCompanyCount = fields.filter(
    (field) =>
      ["company_name", "company_id"].includes(field.canonical_field) &&
      field.validation_mode === "suggest",
  ).length;
  // Guards work in measuring mode too, so they are described whether or not a field suggests.
  const nameGuarded = fields.some(
    (field) =>
      ["full_name", "first_name", "last_name"].includes(field.canonical_field) &&
      field.validation_mode !== "off" &&
      field.require_complete_name,
  );
  const phoneGuarded = fields.some(
    (field) =>
      field.canonical_field === "phone" &&
      field.validation_mode !== "off" &&
      field.require_valid_phone,
  );
  const foreignAddressGuarded = fields.some(
    (field) =>
      field.canonical_field === "postal_code" &&
      field.validation_mode !== "off" &&
      field.require_domestic_address,
  );
  const guardCount = [nameGuarded, phoneGuarded, foreignAddressGuarded].filter(Boolean).length;
  const description = [
    nameGuarded
      ? t(
          "Bez celého jména objednávku nedokončíme.",
          "The order cannot be completed without a full name.",
        )
      : assistedNameCount > 0
        ? t(
            "Neúplné jméno vysvětlíme bez blokace objednávky.",
            "An incomplete name is explained without blocking the order.",
          )
        : null,
    phoneGuarded
      ? t(
          "Bez platného telefonu objednávku nedokončíme.",
          "The order cannot be completed without a valid phone number.",
        )
      : null,
    foreignAddressGuarded
      ? t(
          "Zahraniční adresu ukážeme a první dokončení jednou zastavíme.",
          "A foreign address is pointed out and the first completion is stopped once.",
        )
      : null,
    assistedEmailCount > 0
      ? t("Opravu e-mailu zákazník potvrzuje.", "The customer confirms an email fix.")
      : null,
    automaticPhoneCount > 0
      ? t(
          "Český telefon se bezpečně a tiše zformátuje.",
          "A Czech phone number is formatted safely and silently.",
        )
      : null,
    assistedAddressCount > 0
      ? t(
          "Výběr z RÚIAN doplní ulici, město a PSČ až po potvrzení zákazníkem.",
          "Picking from RÚIAN fills in street, city and PSČ only after the customer confirms.",
        )
      : null,
    villageStreetCount > 0
      ? t(
          "V obci bez ulic doplníme k číslu domu název obce; zákazník to může vrátit.",
          "In a municipality without streets the house number gets the village name; the customer can undo it.",
        )
      : null,
    assistedCompanyCount > 0
      ? t(
          "Výběr firmy doplní firemní a fakturační údaje z ARES s možností vrácení.",
          "Picking a company fills in company and billing details from ARES, with undo.",
        )
      : null,
    guardCount > 0
      ? t(
          "Jiné kontroly objednávku neblokují a při výpadku Checkdropu projde vše.",
          "No other check blocks the order, and everything goes through if Checkdrop is down.",
        )
      : t("Objednávka se neblokuje.", "The order is never blocked."),
  ]
    .filter(Boolean)
    .join(" ");
  return { assistedFieldCount, guardCount, description };
}
