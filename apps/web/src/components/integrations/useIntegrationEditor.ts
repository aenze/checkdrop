import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { api, messageFrom } from "./api";
import type { NewFormInput, NewIntegrationInput } from "./Forms";
import {
  type CanonicalField,
  type ConfigVersion,
  defaultForm,
  type FormScan,
  fieldRequest,
  type Integration,
  type IntegrationField,
  type IntegrationFormProfile,
  isExecutableField,
  validateFields,
} from "./model";
export function useIntegrationEditor() {
  const [integrations, setIntegrations] = useState<readonly Integration[]>([]);
  const [selected, setSelected] = useState<Integration | null>(null);
  const [selectedForm, setSelectedForm] = useState<IntegrationFormProfile | null>(null);
  const [fields, setFields] = useState<readonly IntegrationField[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingForm, setCreatingForm] = useState(false);
  const [versions, setVersions] = useState<readonly ConfigVersion[]>([]);

  const selectionRequest = useRef(0);
  const confirmedNavigation = useRef(false);
  const [rootDraft, setRootDraft] = useState("");
  const [pendingTransition, setPendingTransition] = useState<(() => void) | null>(null);
  const fieldsDirty =
    JSON.stringify(fields.map(fieldRequest)) !==
    JSON.stringify((selectedForm?.fields ?? []).map(fieldRequest));
  const rootDirty = selectedForm !== null && rootDraft.trim() !== selectedForm.root_selector;
  const dirty = fieldsDirty || rootDirty;
  useEffect(() => {
    if (selectedForm?.id) setRootDraft(selectedForm.root_selector);
    else setRootDraft("");
  }, [selectedForm?.id, selectedForm?.root_selector]);
  const transition = (action: () => void) => {
    if (busy !== null) return;
    if (dirty) setPendingTransition(() => action);
    else action();
  };
  useEffect(() => {
    if (!dirty && busy === null) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (confirmedNavigation.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === "_blank" ||
        link.hasAttribute("download")
      )
        return;
      event.preventDefault();
      if (busy === null)
        setPendingTransition(() => () => {
          confirmedNavigation.current = true;
          window.location.assign(link.href);
        });
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate);
    };
  }, [dirty, busy]);

  useEffect(() => {
    let cancelled = false;
    const request = selectionRequest.current;
    async function load() {
      setLoading(true);
      try {
        const payload = await api<{ data: readonly Integration[] }>("/integrations");
        if (cancelled) return;
        setIntegrations(payload.data);
        const requested = new URLSearchParams(window.location.search).get("site");
        const first = payload.data.find((site) => site.id === requested) ?? payload.data[0] ?? null;
        const firstForm = first ? defaultForm(first) : null;
        setSelected(first);
        setSelectedForm(firstForm);
        setFields(firstForm?.fields ?? []);
        if (first && firstForm) {
          const history = await api<{ data: readonly ConfigVersion[] }>(
            `/integrations/${first.id}/forms/${firstForm.id}/versions`,
          );
          if (!cancelled && request === selectionRequest.current) setVersions(history.data);
        }
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(messageFrom(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadVersions = async (
    integrationId: string,
    formId: string,
    request = selectionRequest.current,
  ) => {
    const payload = await api<{ data: readonly ConfigVersion[] }>(
      `/integrations/${integrationId}/forms/${formId}/versions`,
    );
    if (request === selectionRequest.current) setVersions(payload.data);
  };

  const choose = async (integration: Integration) => {
    const request = ++selectionRequest.current;
    setNotice(null);
    setVersions([]);
    setBusy("detail");
    setError(null);
    try {
      const detail = await api<Integration>(`/integrations/${integration.id}`);
      if (request !== selectionRequest.current) return;
      const form = defaultForm(detail);
      setSelected(detail);
      setSelectedForm(form);
      setFields(form?.fields ?? []);
      if (form) await loadVersions(detail.id, form.id, request);
    } catch (caught) {
      if (request === selectionRequest.current) setError(messageFrom(caught));
    } finally {
      if (request === selectionRequest.current) setBusy(null);
    }
  };

  const chooseForm = async (form: IntegrationFormProfile) => {
    if (!selected) return;
    const request = ++selectionRequest.current;
    setVersions([]);
    setNotice(null);
    setSelectedForm(form);
    setFields(form.fields);
    setBusy("detail");
    setError(null);
    try {
      await loadVersions(selected.id, form.id, request);
    } catch (caught) {
      if (request === selectionRequest.current) setError(messageFrom(caught));
    } finally {
      if (request === selectionRequest.current) setBusy(null);
    }
  };

  const create = async (input: NewIntegrationInput) => {
    setBusy("create");
    setError(null);
    try {
      const integration = await api<Integration>("/integrations", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const form = defaultForm(integration);
      setCreating(false);
      setSelected(integration);
      setSelectedForm(form);
      setFields(form?.fields ?? []);
      setVersions([]);
      setIntegrations((current) => [integration, ...current]);
      setNotice(
        t(
          "Napojení je založené. Teď načtu formulář a navrhnu mapování polí.",
          "The connection is created. Now loading the form to suggest a field mapping.",
        ),
      );
      if (form) await scan(integration, form);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  };

  const createForm = async (input: NewFormInput) => {
    if (!selected) return;
    setBusy("create-form");
    setError(null);
    try {
      const previousIds = new Set(selected.forms.map((form) => form.id));
      const updated = await api<Integration>(`/integrations/${selected.id}/forms`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      const form = updated.forms.find((candidate) => !previousIds.has(candidate.id)) ?? null;
      setSelected(updated);
      setIntegrations((current) =>
        current.map((integration) => (integration.id === updated.id ? updated : integration)),
      );
      setCreatingForm(false);
      setSelectedForm(form);
      setFields(form?.fields ?? []);
      setVersions([]);
      setNotice(
        t(
          "Formulář je přidaný. Teď načtu jeho pole a připravím mapování.",
          "The form is added. Now loading its fields to prepare the mapping.",
        ),
      );
      if (form) await scan(updated, form);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  };

  const scan = async (integration = selected, form = selectedForm) => {
    if (!integration || !form) return;
    setBusy("scan");
    setError(null);
    try {
      const result = await api<FormScan>(`/integrations/${integration.id}/forms/${form.id}/scan`, {
        method: "POST",
        body: "{}",
      });
      const hasCustomerType = result.fields.some(
        (field) => field.canonicalField === "customer_type",
      );
      const hasProfileDetails = result.fields.some(
        (field) => field.canonicalField === "profile_details_enabled",
      );
      const hasAlternateShipping = result.fields.some(
        (field) => field.canonicalField === "alternate_shipping_enabled",
      );
      const groups = new Map<string, typeof result.fields>();
      for (const field of result.fields) {
        const root = field.rootSelector ?? "body";
        groups.set(root, [...(groups.get(root) ?? []), field]);
      }
      let activeForm = form;
      let activeRoot = form.root_selector || "body";
      if (activeRoot === "body" && groups.size > 0 && !groups.has("body")) {
        const preferred = [...groups.entries()].sort(
          (left, right) => right[1].length - left[1].length,
        )[0]?.[0];
        if (preferred) {
          const updated = await api<Integration>(
            `/integrations/${integration.id}/forms/${form.id}/root`,
            { method: "PUT", body: JSON.stringify({ root_selector: preferred }) },
          );
          activeForm = updated.forms.find((candidate) => candidate.id === form.id) ?? form;
          activeRoot = preferred;
          setSelected(updated);
          setSelectedForm(activeForm);
          setIntegrations((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          );
        }
      }
      const relevantFields = groups.get(activeRoot) ?? result.fields;
      const companyFields = new Set<CanonicalField>(["company_name", "company_id", "vat_id"]);
      const conditionFor = (field: (typeof relevantFields)[number]) => {
        const conditions: string[] = [];
        if (field.context === "shipping" && hasAlternateShipping) {
          conditions.push("alternate_shipping_enabled=true");
        } else if (
          hasProfileDetails &&
          !["email", "customer_type", "profile_details_enabled"].includes(field.canonicalField)
        ) {
          conditions.push("profile_details_enabled=true");
        }
        if (hasCustomerType && companyFields.has(field.canonicalField)) {
          conditions.push("customer_type=company");
        }
        return conditions.length > 0 ? conditions.join("&") : null;
      };
      const mapped = relevantFields.map<IntegrationField>((field) => ({
        id: `scan:${field.context}:${field.selector}`,
        selector: field.selector,
        label: field.label,
        name: field.name,
        canonical_field: field.canonicalField,
        context: field.context,
        condition_key: conditionFor(field),
        required: field.required,
        validation_mode: field.validationMode,
        validation_trigger: field.validationTrigger,
        confidence: field.confidence,
        detected: true,
      }));
      setFields(mapped);
      if (result.drift.changed) {
        setError(
          t(
            `Formulář se od posledního nastavení změnil: ${result.drift.missing_selectors.length} původních a ${result.drift.added_selectors.length} nových selektorů. Mapování zkontrolujte a znovu uložte.`,
            `The form has changed since it was last set up: ${result.drift.missing_selectors.length} original and ${result.drift.added_selectors.length} new selectors. Review the mapping and save it again.`,
          ),
        );
      } else {
        const groupSummary = [...groups.entries()]
          .map(([root, groupFields]) => `${root} (${groupFields.length})`)
          .join(", ");
        setNotice(
          groups.size > 1
            ? t(
                `Nalezené skupiny: ${groupSummary}. Teď upravujete ${activeRoot}; ostatní přidejte jako samostatné formuláře.`,
                `Groups found: ${groupSummary}. You are editing ${activeRoot}; add the others as separate forms.`,
              )
            : t(
                `Nalezeno ${mapped.length} polí pro ${activeRoot}. Návrh ještě zkontrolujte a uložte.`,
                `Found ${mapped.length} ${mapped.length === 1 ? "field" : "fields"} for ${activeRoot}. Review the suggestion and save it.`,
              ),
        );
      }
    } catch (caught) {
      setError(
        `${messageFrom(caught)} ${t("Pole můžete přidat ručně níže.", "You can add fields manually below.")}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const updateField = (index: number, patch: Partial<IntegrationField>) => {
    setFields((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
    );
  };

  const addField = () => {
    setFields((current) => [
      ...current,
      {
        id: `manual:${globalThis.crypto.randomUUID()}`,
        selector: "",
        label: t("Nové pole", "New field"),
        name: null,
        canonical_field: "unmapped",
        context: "billing",
        condition_key: null,
        required: false,
        validation_mode: "off",
        validation_trigger: "blur",
        confidence: null,
        detected: false,
      },
    ]);
  };

  const saveFields = async (
    integration = selected,
    targetForm = selectedForm,
  ): Promise<boolean> => {
    if (!integration || !targetForm) return false;
    const validationError = validateFields(fields);
    if (validationError) {
      setError(validationError);
      return false;
    }
    setBusy("save");
    setError(null);
    try {
      const updated = await api<Integration>(
        `/integrations/${integration.id}/forms/${targetForm.id}/fields`,
        {
          method: "PUT",
          body: JSON.stringify({
            fields: fields.map(fieldRequest),
            expected_version: targetForm.config_version,
          }),
        },
      );
      const form = updated.forms.find((candidate) => candidate.id === targetForm.id) ?? null;
      setSelected(updated);
      setSelectedForm(form);
      setFields(form?.fields ?? []);
      setIntegrations((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      if (form) {
        try {
          await loadVersions(updated.id, form.id);
        } catch {
          setError(
            t(
              "Mapování je uložené, historii se nepodařilo načíst.",
              "The mapping is saved, but the history could not be loaded.",
            ),
          );
        }
      }
      setNotice(
        t(
          "Mapování je uložené. Stav napojení odpovídá potvrzené konfiguraci.",
          "The mapping is saved. The connection status matches the confirmed configuration.",
        ),
      );
      return true;
    } catch (caught) {
      setError(messageFrom(caught));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (version: number) => {
    if (!selected || !selectedForm) return;
    setBusy(`rollback:${version}`);
    setError(null);
    try {
      const updated = await api<Integration>(
        `/integrations/${selected.id}/forms/${selectedForm.id}/rollback`,
        {
          method: "POST",
          body: JSON.stringify({ version }),
        },
      );
      const form = updated.forms.find((candidate) => candidate.id === selectedForm.id) ?? null;
      setSelected(updated);
      setSelectedForm(form);
      setFields(form?.fields ?? []);
      setIntegrations((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      if (form) await loadVersions(updated.id, form.id);
      setNotice(
        t(
          `Obnovena konfigurace v${version}. Vznikla nová verze v${form?.config_version ?? "?"}.`,
          `Configuration v${version} restored as new version v${form?.config_version ?? "?"}.`,
        ),
      );
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  };

  const setState = async (state: "shadow" | "paused") => {
    if (!selected) return;
    setBusy("state");
    setError(null);
    try {
      const updated = await api<Integration>(`/integrations/${selected.id}/state`, {
        method: "POST",
        body: JSON.stringify({ state }),
      });
      const form = selectedForm
        ? (updated.forms.find((candidate) => candidate.id === selectedForm.id) ?? null)
        : defaultForm(updated);
      setSelected(updated);
      setSelectedForm(form);
      setFields(form?.fields ?? []);
      setIntegrations((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice(
        state === "shadow"
          ? t(
              "Kontrola je aktivní. Pole v režimu Jen sledovat nic nemění; e-mailový návrh se použije jen po kliknutí zákazníka.",
              "Checks are active. Fields set to Monitor only change nothing; an email suggestion applies only after the customer clicks it.",
            )
          : t("Napojení je pozastavené.", "The connection is paused."),
      );
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  };

  const saveRootSelector = async (rootSelector: string) => {
    if (!selected || !selectedForm) return null;
    setBusy("root-selector");
    setError(null);
    try {
      const updated = await api<Integration>(
        `/integrations/${selected.id}/forms/${selectedForm.id}/root`,
        { method: "PUT", body: JSON.stringify({ root_selector: rootSelector }) },
      );
      const form = updated.forms.find((candidate) => candidate.id === selectedForm.id) ?? null;
      setSelected(updated);
      setSelectedForm(form);
      // Saving the root must preserve the independent mapping draft.
      setRootDraft(form?.root_selector ?? rootSelector);
      setIntegrations((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice(
        t(
          "Kořen formuláře je uložený. Rozpracované mapování zůstalo zachované.",
          "The form root is saved. Your unsaved mapping is kept.",
        ),
      );
      return updated;
    } catch (caught) {
      setError(messageFrom(caught));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const setSelectedFormState = async (state: "configured" | "paused") => {
    if (!selected || !selectedForm) return;
    setBusy("form-state");
    setError(null);
    try {
      const updated = await api<Integration>(
        `/integrations/${selected.id}/forms/${selectedForm.id}/state`,
        { method: "POST", body: JSON.stringify({ state }) },
      );
      const form = updated.forms.find((candidate) => candidate.id === selectedForm.id) ?? null;
      setSelected(updated);
      setSelectedForm(form);
      setFields(form?.fields ?? []);
      setIntegrations((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice(
        state === "paused"
          ? t("Formulář je pozastavený.", "The form is paused.")
          : t("Formulář je znovu aktivní.", "The form is active again."),
      );
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    let integration = selected;
    let form = selectedForm;
    if (rootDirty) {
      integration = await saveRootSelector(rootDraft.trim());
      if (!integration) return false;
      form = integration.forms.find((candidate) => candidate.id === selectedForm?.id) ?? null;
    }
    return fieldsDirty ? saveFields(integration, form) : true;
  };
  const discardDraft = () => {
    setFields(selectedForm?.fields ?? []);
    setRootDraft(selectedForm?.root_selector ?? "");
  };
  const persistedFields = selectedForm?.fields ?? [];
  const assistanceActive = selected?.state === "shadow" && selectedForm?.state === "configured";
  const mappedCount = fields.filter(isExecutableField).length;
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
  const assistedFieldCount = persistedFields.filter(
    (field) => assistableFields.has(field.canonical_field) && field.validation_mode === "suggest",
  ).length;
  const assistedNameCount = persistedFields.filter(
    (field) =>
      ["full_name", "first_name", "last_name"].includes(field.canonical_field) &&
      field.validation_mode === "suggest",
  ).length;
  const assistedEmailCount = persistedFields.filter(
    (field) => field.canonical_field === "email" && field.validation_mode === "suggest",
  ).length;
  const automaticPhoneCount = persistedFields.filter(
    (field) => field.canonical_field === "phone" && field.validation_mode === "suggest",
  ).length;
  const assistedAddressCount = persistedFields.filter(
    (field) => field.canonical_field === "street_line" && field.validation_mode === "suggest",
  ).length;
  const assistedCompanyCount = persistedFields.filter(
    (field) =>
      ["company_name", "company_id"].includes(field.canonical_field) &&
      field.validation_mode === "suggest",
  ).length;
  const assistanceDescription = [
    assistedNameCount > 0
      ? t(
          "Neúplné jméno vysvětlíme bez blokace objednávky.",
          "An incomplete name is explained without blocking the order.",
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
    assistedCompanyCount > 0
      ? t(
          "Výběr firmy doplní firemní a fakturační údaje z ARES s možností vrácení.",
          "Picking a company fills in company and billing details from ARES, with undo.",
        )
      : null,
    t("Objednávka se neblokuje.", "The order is never blocked."),
  ]
    .filter(Boolean)
    .join(" ");
  const totalMappedCount =
    selected?.forms
      .filter((form) => form.state === "configured")
      .reduce((total, form) => total + form.fields.filter(isExecutableField).length, 0) ?? 0;
  const receivedData = (selected?.activity?.observation_count_24h ?? 0) > 0;
  const currentStep = !selected
    ? 1
    : receivedData
      ? 5
      : selected.state === "shadow"
        ? 4
        : selectedForm?.fields.length
          ? 3
          : 2;

  return {
    integrations,
    selected,
    selectedForm,
    fields,
    setFields,
    loading,
    busy,
    error,
    setError,
    notice,
    setNotice,
    creating,
    setCreating,
    creatingForm,
    setCreatingForm,
    versions,
    rootDraft,
    setRootDraft,
    pendingTransition,
    setPendingTransition,
    dirty,
    transition,
    choose,
    chooseForm,
    create,
    createForm,
    scan,
    updateField,
    addField,
    rollback,
    setState,
    saveRootSelector,
    setSelectedFormState,
    saveDraft,
    discardDraft,
    assistanceActive,
    mappedCount,
    assistedFieldCount,
    assistanceDescription,
    totalMappedCount,
    receivedData,
    currentStep,
  };
}
