// SPDX-License-Identifier: MIT
// The hosted checkout script built from this file runs inside shops' pages, so it is MIT licensed,
// like @checkdrop/core and the country pack it is composed with. The rest of apps/server is AGPL.
import {
  type EmbedMessageKey,
  type EmbedTexts,
  parseEmailForSuggestion,
  personNameRequirement,
} from "@checkdrop/core";
import { defaultCountryPack } from "./country-packs.js";

function checkdropEmbedRuntime(
  nameRequirement: typeof personNameRequirement,
  parseEmail: typeof parseEmailForSuggestion,
  instantCorrections: Readonly<Record<string, string>>,
  defaultTexts: EmbedTexts,
  looksForeign: (address: string, city: string | null, postalCode: string | null) => boolean,
  translations: Readonly<Record<string, EmbedTexts>>,
) {
  // The shop page's language picks the texts; Czech pages and unknown languages keep the default.
  const pageLanguage = (document.documentElement.lang || "").slice(0, 2).toLowerCase();
  const texts = translations[pageLanguage] ?? defaultTexts;
  // Fills {name} placeholders; an unknown placeholder stays visible rather than disappearing.
  const message = (key: EmbedMessageKey, values: Readonly<Record<string, string>> = {}) =>
    texts.messages[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
  const deliveryAddressWarning = message("address.incomplete");
  const addressTypingTitle = message("address.pick");
  const houseNumberMissingWarning = message("address.house_number_missing");
  const addressNotVerifiedWarning = message("address.not_verified");
  const foreignAddressWarning = message("address.foreign_country");
  // Set from the integration config; a missing flag keeps the legacy address payload.
  let addressComponentsEnabled = false;
  // The last address answer per street control, so leaving the field can show its warning.
  type AddressAnswer = {
    value: string;
    formId: string;
    field: ConfiguredField;
    fields: readonly ConfiguredField[];
    result: unknown;
    requestId: string | null;
  };
  const addressAnswers = new WeakMap<ValueControl, AddressAnswer>();
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;
  const site = script.dataset.checkdropSite?.trim() ?? "";
  if (!site) return;

  const apiBase = (script.dataset.checkdropApi || new URL(script.src).origin).replace(/\/+$/, "");
  // Plugin, GTM and manual snippets may overlap. One observer per site/API per document.
  const runtimeWindow = window as Window & { __checkdropRuntimes?: Set<string> };
  const runtimeKey = `${apiBase}\0${site}`;
  runtimeWindow.__checkdropRuntimes ??= new Set<string>();
  const runtimes = runtimeWindow.__checkdropRuntimes;
  if (runtimes.has(runtimeKey)) return;
  runtimes.add(runtimeKey);
  // POST responses are never stored by the HTTP cache, and the API also sends no-store, so POST
  // requests keep the default mode.
  const POST_CACHE_MODE: RequestCache = "default";
  // After a 429 that kind of request pauses until Retry-After has passed; the checkout keeps working.
  type RequestKind = "validation" | "assist" | "checkout";
  const pausedUntil = new Map<RequestKind, number>();
  async function send(kind: RequestKind, url: string, init: RequestInit) {
    if ((pausedUntil.get(kind) ?? 0) > Date.now()) throw new Error("Checkdrop paused");
    const response = await fetch(url, init);
    if (response.status === 429) {
      const header = response.headers.get("Retry-After") ?? "";
      const seconds = /^\d+$/.test(header)
        ? Number(header)
        : (Date.parse(header) - Date.now()) / 1_000;
      pausedUntil.set(
        kind,
        Date.now() + Math.min(600, Math.max(1, Number.isFinite(seconds) ? seconds : 30)) * 1_000,
      );
    }
    return response;
  }
  // JSON sent as text/plain is a CORS "simple" request: no preflight, so one round trip per check.
  function post(
    kind: RequestKind,
    path: string,
    formId: string,
    body: unknown,
    init: RequestInit = {},
  ) {
    return send(
      kind,
      `${apiBase}${path}?site=${encodeURIComponent(site)}&form=${encodeURIComponent(formId)}&session=${encodeURIComponent(checkoutSessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(body),
        credentials: "omit",
        cache: POST_CACHE_MODE,
        redirect: "error",
        ...init,
      },
    );
  }
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const active = new Map<string, AbortController>();
  // Request in flight per field, so change + focusout for the same value send it only once.
  const activeRequests = new Map<string, { fingerprint: string; value: string }>();
  const composingControls = new WeakSet<ValueControl>();
  // Offers shown before any request. Their interaction events wait for the server's request_id for
  // the same value and suggestion; unconfirmed events are dropped, never sent without an ID.
  type AssistEvent = "shown" | "applied" | "kept";
  type EmailOffer = {
    original: string;
    suggestion: string;
    requestId: string | null;
    choice: "pending" | "applied" | "kept";
    events: AssistEvent[];
    dropTimer: ReturnType<typeof setTimeout> | undefined;
  };
  // Keyed by the typed value: a settled offer keeps waiting for its request_id after the value changes.
  const emailOffers = new WeakMap<ValueControl, Map<string, EmailOffer>>();
  function offersFor(control: ValueControl) {
    let offers = emailOffers.get(control);
    if (!offers) {
      offers = new Map();
      emailOffers.set(control, offers);
    }
    return offers;
  }
  const completedRequests = new Map<string, string>();
  const autocompleteCleanup = new Map<ValueControl, () => void>();
  const assistPrompts = new Map<ValueControl, HTMLElement>();
  const assistTrackingQueues = new Map<string, Promise<void>>();
  const liveFormattedPhones = new WeakSet<ValueControl>();
  const addressMutationControls = new WeakSet<ValueControl>();
  const touchedNameControls = new WeakSet<ValueControl>();
  const acceptedNameValues = new WeakMap<ValueControl, string>();
  const checkdropBlockedEvents = new WeakSet<Event>();
  let disposeObservation: (() => void) | null = null;
  let loadedPath = pagePath();
  const checkoutSessionId = loadCheckoutSessionId(site);

  void loadConfig(loadedPath);
  const pathTimer = window.setInterval(() => {
    scanPurchases();
    const nextPath = pagePath();
    if (nextPath === loadedPath) return;
    loadedPath = nextPath;
    disposeCurrentObservation();
    void loadConfig(nextPath);
  }, 1_000);
  window.addEventListener(
    "pagehide",
    () => {
      window.clearInterval(pathTimer);
      disposeCurrentObservation();
    },
    { once: true },
  );

  async function loadConfig(path: string) {
    // Per tab, site and page: a config younger than 10 minutes activates at once from storage and
    // is refreshed in the background; only a changed answer restarts the observation.
    const storageKey = `checkdrop:config:${apiBase}|${site}|${path}`;
    let applied: string | null = null;
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      const age = Date.now() - stored?.at;
      if (age >= 0 && age < 600_000 && stored.config && typeof stored.config === "object") {
        applied = JSON.stringify(stored.config);
        applyConfig(path, stored.config);
      }
    } catch {
      // Storage may be blocked or hold something else; the network answer still applies.
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await send(
        "validation",
        `${apiBase}/v1/integration/config?site=${encodeURIComponent(site)}&path=${encodeURIComponent(path)}&session=${encodeURIComponent(checkoutSessionId)}`,
        {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        // A refused site or page retires the stored copy; a busy or failing API keeps it working.
        if (response.status < 500 && response.status !== 429) {
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            /* Storage may be unavailable. */
          }
          if (applied !== null && path === pagePath()) disposeCurrentObservation();
        }
        return;
      }
      const config = (await response.json()) as Record<string, unknown>;
      delete config.request_id;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), config }));
      } catch {
        /* Storage may be unavailable or full. */
      }
      if (JSON.stringify(config) !== applied) applyConfig(path, config);
    } catch {
      // The checkout remains fully functional when Checkdrop is unavailable.
    } finally {
      clearTimeout(timeout);
    }
  }

  function applyConfig(
    path: string,
    config: {
      state?: unknown;
      fields?: unknown;
      config_version?: unknown;
      form?: unknown;
      forms?: unknown;
      features?: unknown;
    },
  ) {
    addressComponentsEnabled =
      Boolean(config.features) &&
      typeof config.features === "object" &&
      (config.features as { address_components?: unknown }).address_components === true;
    if (path !== pagePath()) return;
    if (config.state !== "shadow") {
      disposeCurrentObservation();
      return;
    }
    const legacyForm = legacyConfiguredForm(config.form, config.fields);
    const configuredForms = Array.isArray(config.forms)
      ? config.forms.filter(isConfiguredForm)
      : legacyForm
        ? [legacyForm]
        : [];
    const fields = configuredForms.flatMap((form) =>
      form.fields.filter(isConfiguredField).map((field) => ({
        ...field,
        form_id: form.id,
        form_name: form.name,
        root_selector: form.root_selector,
      })),
    );
    disposeCurrentObservation();
    if (fields.length === 0) return;
    disposeObservation = observe(fields);
    document.dispatchEvent(
      new CustomEvent("checkdrop:ready", {
        detail: {
          configVersion: Number.isInteger(config.config_version) ? config.config_version : null,
          forms: configuredForms.map((form) => ({ id: form.id, name: form.name })),
        },
      }),
    );
  }

  type ConfiguredForm = {
    id: string;
    name: string;
    root_selector: string;
    fields: readonly unknown[];
  };

  function isConfiguredForm(value: unknown): value is ConfiguredForm {
    if (!value || typeof value !== "object") return false;
    const form = value as Partial<ConfiguredForm>;
    return (
      typeof form.id === "string" &&
      form.id.length > 0 &&
      typeof form.name === "string" &&
      typeof form.root_selector === "string" &&
      form.root_selector.length > 0 &&
      Array.isArray(form.fields)
    );
  }

  function legacyConfiguredForm(formValue: unknown, fieldsValue: unknown): ConfiguredForm | null {
    if (!formValue || typeof formValue !== "object" || !Array.isArray(fieldsValue)) return null;
    const form = formValue as { id?: unknown; name?: unknown; root_selector?: unknown };
    return typeof form.id === "string" && form.id.length > 0 && typeof form.name === "string"
      ? {
          id: form.id,
          name: form.name,
          root_selector:
            typeof form.root_selector === "string" && form.root_selector
              ? form.root_selector
              : "body",
          fields: fieldsValue,
        }
      : null;
  }

  type ConfiguredField = {
    selector: string;
    canonical_field: string;
    context: string;
    condition_key: string | null;
    required: boolean;
    require_complete_name?: boolean;
    require_domestic_address?: boolean;
    submit_selector?: string | null;
    validation_mode: "shadow" | "suggest";
    validation_trigger: "input" | "blur" | "submit";
    form_id: string;
    form_name: string;
    root_selector: string;
  };

  function isConfiguredField(
    value: unknown,
  ): value is Omit<ConfiguredField, "form_id" | "form_name" | "root_selector"> {
    if (!value || typeof value !== "object") return false;
    const field = value as Partial<ConfiguredField>;
    return (
      typeof field.selector === "string" &&
      field.selector.length > 0 &&
      typeof field.canonical_field === "string" &&
      typeof field.context === "string" &&
      (field.condition_key === null || typeof field.condition_key === "string") &&
      typeof field.required === "boolean" &&
      (field.validation_mode === "shadow" || field.validation_mode === "suggest") &&
      (field.validation_trigger === "input" ||
        field.validation_trigger === "blur" ||
        field.validation_trigger === "submit")
    );
  }

  function observe(fields: readonly ConfiguredField[]): () => void {
    const disposeCheckoutTracking = observeCheckoutTracking(fields);
    const nameErrors = new Map<ValueControl, string | null>();
    const visibleControl = (control: ValueControl) =>
      !control.matches(":disabled") &&
      control.isConnected &&
      control.getClientRects().length > 0 &&
      !control.closest("[hidden], [inert]") &&
      getComputedStyle(control).visibility !== "hidden";
    const activeName = (field: ConfiguredField, control: ValueControl) =>
      field.require_complete_name === true &&
      ["full_name", "first_name", "last_name"].includes(field.canonical_field) &&
      visibleControl(control) &&
      conditionMatches(
        field.condition_key,
        fields.filter((item) => item.form_id === field.form_id),
      );
    const clearNameError = (control: ValueControl) => {
      if (!nameErrors.has(control)) return;
      restoreAttribute(control, "aria-invalid", nameErrors.get(control) ?? null);
      nameErrors.delete(control);
      clearAssistPrompt(control);
    };
    const checkName = (field: ConfiguredField, control: ValueControl) => {
      if (!activeName(field, control)) {
        clearNameError(control);
        return true;
      }
      const error = allowsCompanyDeliveryRecipient(
        field,
        fields.filter((candidate) => candidate.form_id === field.form_id),
      )
        ? control.value.trim()
          ? null
          : nameRequirement("", "full")
        : nameRequirement(control.value, field.canonical_field === "full_name" ? "full" : "part");
      if (error) {
        if (!nameErrors.has(control)) nameErrors.set(control, control.getAttribute("aria-invalid"));
        control.setAttribute("aria-invalid", "true");
        showAssistWarning(field.form_id, control, error, null);
        return false;
      }
      clearNameError(control);
      if (field.validation_mode !== "suggest" || acceptedNameValues.get(control) === control.value)
        showNameOkay(control);
      return true;
    };
    // A shop that delivers only within Czechia marks its PSČ field. A clearly foreign address in
    // that group is pointed out on leaving a field and stops the final click once; the same address
    // then goes through, so a customer who really lives in Czechia is never locked out.
    const foreignWarnings = new Map<string, { control: ValueControl; element: HTMLElement }>();
    const acknowledgedForeignAddresses = new Set<string>();
    const domesticGuardFor = (field: ConfiguredField) =>
      fields.find(
        (candidate) =>
          candidate.require_domestic_address === true &&
          candidate.canonical_field === "postal_code" &&
          candidate.form_id === field.form_id &&
          candidate.context === field.context,
      );
    const foreignAddress = (field: ConfiguredField) => {
      const formFields = fields.filter((candidate) => candidate.form_id === field.form_id);
      if (!conditionMatches(field.condition_key, formFields)) return null;
      const visible = (canonicalField: string) => {
        const candidate = findExactField(formFields, canonicalField, field.context);
        if (!candidate || !conditionMatches(candidate.condition_key, formFields)) return null;
        const control = firstControl(candidate.selector, candidate.root_selector);
        return control && visibleControl(control) ? control : null;
      };
      const postal = visible("postal_code");
      if (!postal) return null;
      const city = visible("city");
      const street = visible("street_line");
      const country = visible("country");
      const slovakCountry =
        country !== null &&
        [country.value, country.selectedOptions?.[0]?.textContent ?? ""].some((value) =>
          ["sk", "svk", "slovensko", "slovenska republika", "slovakia"].includes(
            normalizeLookup(value),
          ),
        );
      const target = looksForeign("", null, postal.value)
        ? postal
        : city && looksForeign("", city.value, null)
          ? city
          : street && looksForeign(street.value, null, null)
            ? street
            : slovakCountry
              ? country
              : null;
      if (!target) return null;
      const signature = [
        field.form_id,
        field.context,
        postal.value,
        city?.value ?? "",
        street?.value ?? "",
        country?.value ?? "",
      ]
        .map(normalizeLookup)
        .join("\u0000");
      return { control: target, signature };
    };
    const refreshForeignWarning = (field: ConfiguredField, show: boolean) => {
      const key = `${field.form_id}:${field.context}`;
      const found = foreignAddress(field);
      const current = foreignWarnings.get(key);
      if (current && (!found || current.control !== found.control)) {
        if (assistPrompts.get(current.control) === current.element)
          clearAssistPrompt(current.control);
        foreignWarnings.delete(key);
      }
      const shown = foreignWarnings.get(key);
      if (
        found &&
        show &&
        (!shown || assistPrompts.get(found.control) !== shown.element || !shown.element.isConnected)
      ) {
        showAssistWarning(field.form_id, found.control, foreignAddressWarning, null);
        const element = assistPrompts.get(found.control);
        if (element) foreignWarnings.set(key, { control: found.control, element });
      }
      return found;
    };
    const guardForeignAddress = (
      event: Event,
      form: HTMLFormElement,
      submitter: Element | null,
    ) => {
      for (const field of fields) {
        if (!field.require_domestic_address || field.canonical_field !== "postal_code") continue;
        const control = firstControl(field.selector, field.root_selector);
        if (!control || control.closest("form") !== form) continue;
        if (field.submit_selector && submitter) {
          try {
            if (!submitter.closest(field.submit_selector)) continue;
          } catch {
            continue;
          }
        }
        const found = refreshForeignWarning(field, true);
        if (!found || acknowledgedForeignAddresses.has(found.signature)) continue;
        acknowledgedForeignAddresses.add(found.signature);
        event.preventDefault();
        event.stopImmediatePropagation();
        checkdropBlockedEvents.add(event);
        recordCheckoutEvent(field, "blocked", "checkdrop_foreign_address");
        if (found.control instanceof HTMLElement) found.control.focus();
        return true;
      }
      return false;
    };
    const guard = (event: Event, form: HTMLFormElement, submitter: Element | null) => {
      let firstInvalid: ValueControl | null = null;
      for (const field of fields) {
        if (!field.require_complete_name) continue;
        const control = firstControl(field.selector, field.root_selector);
        if (
          !control ||
          !(
            control instanceof HTMLInputElement ||
            control instanceof HTMLTextAreaElement ||
            control instanceof HTMLSelectElement
          ) ||
          control.form !== form
        )
          continue;
        if (field.submit_selector && submitter) {
          try {
            if (!submitter.closest(field.submit_selector)) continue;
          } catch {
            continue;
          }
        }
        if (!checkName(field, control)) {
          firstInvalid ??= control;
          schedule(
            field.form_id,
            field,
            fields.filter((item) => item.form_id === field.form_id),
            control,
            control.value,
            0,
          );
        }
      }
      if (!firstInvalid) return guardForeignAddress(event, form, submitter);
      event.preventDefault();
      event.stopImmediatePropagation();
      checkdropBlockedEvents.add(event);
      recordCheckoutEvent(
        fields.find((field) => firstControl(field.selector, field.root_selector) === firstInvalid),
        "blocked",
        "checkdrop_name",
      );
      if (firstInvalid instanceof HTMLElement) firstInvalid.focus();
      return true;
    };
    const onFinalClick = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      for (const field of fields) {
        if (!field.require_complete_name && !field.require_domestic_address) continue;
        let button: Element | null;
        try {
          button = event.target.closest(
            field.submit_selector ||
              'button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]',
          );
        } catch {
          continue;
        }
        if (!button) continue;
        const form =
          button instanceof HTMLButtonElement || button instanceof HTMLInputElement
            ? button.form
            : button.closest("form");
        if (form && guard(event, form, button)) return;
      }
    };
    const preparedPhoneControls = new Map<
      ValueControl,
      { inputMode: string | null; placeholder: string | null }
    >();
    for (const field of fields) {
      if (field.canonical_field !== "phone" || field.validation_mode !== "suggest") continue;
      const control = firstControl(field.selector, field.root_selector);
      if (control) preparePhoneControl(control, preparedPhoneControls);
    }
    const onControlFocus = (event: Event) => {
      const control = asValueControl(event.target);
      if (!control || control.value.trim()) return;
      const phoneField = fields.find(
        (field) =>
          field.canonical_field === "phone" &&
          field.validation_mode === "suggest" &&
          safeMatchesWithin(control, field.selector, field.root_selector),
      );
      if (!phoneField) return;
      preparePhoneControl(control, preparedPhoneControls);
      if (control instanceof HTMLInputElement) {
        setControlValueSilently(control, texts.phonePrefill);
        control.setSelectionRange(control.value.length, control.value.length);
      }
    };
    const onControlKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== "Enter") return;
      const control = asValueControl(event.target);
      if (control && isCzechPhonePrefixOnly(control.value)) setControlValueSilently(control, "");
    };
    const onComposition = (event: Event) => {
      const control = asValueControl(event.target);
      if (!control) return;
      if (event.type === "compositionstart") {
        composingControls.add(control);
        return;
      }
      composingControls.delete(control);
      // Browsers differ in whether a final input event follows compositionend; handle it once here.
      handleControlEvent(control, "input");
    };
    const onControlEvent = (event: Event) => {
      const control = asValueControl(event.target);
      if (!control) return;
      if (
        event.type === "input" &&
        (composingControls.has(control) || (event as InputEvent).isComposing === true)
      )
        return;
      handleControlEvent(control, event.type);
    };
    const handleControlEvent = (control: ValueControl, eventType: string) => {
      const trigger = eventType === "input" ? "input" : "blur";
      if (trigger === "blur") touchedNameControls.add(control);
      if (addressMutationControls.has(control)) return;
      for (const field of fields) {
        const matches = safeMatchesWithin(control, field.selector, field.root_selector);
        const formFields = fields.filter((candidate) => candidate.form_id === field.form_id);
        if (
          matches &&
          eventType !== "focusout" &&
          ["city", "postal_code", "country"].includes(field.canonical_field)
        ) {
          const street = formFields.find(
            (candidate) =>
              candidate.canonical_field === "street_line" && candidate.context === field.context,
          );
          const streetControl = street ? firstControl(street.selector, street.root_selector) : null;
          if (street && streetControl && street.validation_mode === "suggest") {
            const key = `${street.form_id}:${street.context}:${street.canonical_field}`;
            clearTimeout(timers.get(key));
            timers.delete(key);
            active.get(key)?.abort();
            completedRequests.delete(key);
            clearAssistPrompt(streetControl);
          }
        }
        if (
          matches &&
          ["postal_code", "city", "street_line", "country"].includes(field.canonical_field)
        ) {
          const domesticGuard = domesticGuardFor(field);
          // Typing only removes a warning that no longer applies; a new one waits for leaving.
          if (domesticGuard) refreshForeignWarning(domesticGuard, trigger === "blur");
        }
        if (field.require_complete_name) {
          const nameControl = firstControl(field.selector, field.root_selector);
          if (nameControl && !activeName(field, nameControl)) clearNameError(nameControl);
        }
        if (
          trigger === "input" &&
          matches &&
          ["customer_type", "profile_details_enabled", "alternate_shipping_enabled"].includes(
            field.canonical_field,
          )
        ) {
          clearInactiveFields(formFields);
          for (const candidate of formFields) {
            if (!candidate.require_complete_name) continue;
            const candidateControl = firstControl(candidate.selector, candidate.root_selector);
            if (candidateControl && nameErrors.has(candidateControl)) {
              checkName(candidate, candidateControl);
            }
          }
        }
        if (field.canonical_field === "phone" && field.validation_mode === "suggest" && matches) {
          preparePhoneControl(control, preparedPhoneControls);
          if (trigger === "input") formatCzechPhoneControl(control);
          else if (isCzechPhonePrefixOnly(control.value)) setControlValueSilently(control, "");
        }
        if (
          trigger === "input" &&
          field.validation_mode === "suggest" &&
          [
            "email",
            "phone",
            "full_name",
            "first_name",
            "last_name",
            "street_line",
            "company_name",
            "company_id",
          ].includes(field.canonical_field) &&
          matches
        ) {
          completedRequests.delete(`${field.form_id}:${field.context}:${field.canonical_field}`);
          clearAssistPrompt(control);
        }
        if (
          matches &&
          field.canonical_field === "email" &&
          field.validation_mode === "suggest" &&
          conditionMatches(field.condition_key, formFields)
        ) {
          showInstantEmailOffer(field.form_id, field, control, timingNow());
        }
        if (
          matches &&
          field.require_complete_name &&
          (trigger === "blur" || nameErrors.has(control))
        ) {
          if (!checkName(field, control)) {
            schedule(field.form_id, field, formFields, control, control.value, 0);
            continue;
          }
        }
        if (
          matches &&
          trigger === "blur" &&
          field.canonical_field === "street_line" &&
          field.validation_mode === "suggest" &&
          !control.value.trim() &&
          conditionMatches(field.condition_key, formFields) &&
          isCzechCountry(fieldLookupValues(formFields, "country", field.context))
        ) {
          showAssistWarning(field.form_id, control, deliveryAddressWarning, null);
        }
        if (
          matches &&
          trigger === "blur" &&
          field.validation_trigger === "input" &&
          timers.has(`${field.form_id}:${field.context}:${field.canonical_field}`)
        ) {
          // Leaving the field sends the pending check now instead of after the debounce.
          schedule(field.form_id, field, formFields, control, control.value, 0);
          continue;
        }
        if (
          matches &&
          eventType === "focusout" &&
          field.canonical_field === "street_line" &&
          field.validation_mode === "suggest"
        ) {
          const answer = addressAnswers.get(control);
          // An answer received while typing stayed neutral; leaving the field shows its advice.
          if (answer && answer.value === control.value && safeAddressAdvice(answer.result))
            renderAddressAnswer(control, answer, false);
        }
        if (field.validation_trigger !== trigger || !matches) continue;
        if (
          ["first_name", "last_name"].includes(field.canonical_field) &&
          !splitNameReady(field, formFields)
        ) {
          continue;
        }
        schedule(
          field.form_id,
          field,
          formFields,
          control,
          control.value,
          trigger === "input" ? inputDelay(field) : 0,
        );
        if (["city", "postal_code", "country"].includes(field.canonical_field)) {
          const street = formFields.find(
            (candidate) =>
              candidate.canonical_field === "street_line" && candidate.context === field.context,
          );
          const streetControl = street ? firstControl(street.selector, street.root_selector) : null;
          if (street && streetControl) {
            schedule(
              field.form_id,
              street,
              formFields,
              streetControl,
              streetControl.value,
              trigger === "input" ? inputDelay(street) : 0,
            );
          }
        }
      }
    };
    const onSubmit = (event: Event) => {
      if (
        event.target instanceof HTMLFormElement &&
        guard(event, event.target, event instanceof SubmitEvent ? event.submitter : null)
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      for (const field of fields) {
        if (target && !elementInsideRoot(target, field.root_selector)) continue;
        const formFields = fields.filter((candidate) => candidate.form_id === field.form_id);
        const control = firstControl(field.selector, field.root_selector);
        if (
          field.canonical_field === "phone" &&
          field.validation_mode === "suggest" &&
          control &&
          isCzechPhonePrefixOnly(control.value)
        ) {
          setControlValueSilently(control, "");
        }
        if (control) schedule(field.form_id, field, formFields, control, control.value, 0);
      }
    };
    document.addEventListener("focusin", onControlFocus, true);
    document.addEventListener("keydown", onControlKeyDown, true);
    document.addEventListener("input", onControlEvent, true);
    document.addEventListener("compositionstart", onComposition, true);
    document.addEventListener("compositionend", onComposition, true);
    document.addEventListener("change", onControlEvent, true);
    document.addEventListener("click", onFinalClick, true);
    document.addEventListener("focusout", onControlEvent, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      disposeCheckoutTracking();
      document.removeEventListener("focusin", onControlFocus, true);
      document.removeEventListener("keydown", onControlKeyDown, true);
      document.removeEventListener("input", onControlEvent, true);
      document.removeEventListener("compositionstart", onComposition, true);
      document.removeEventListener("compositionend", onComposition, true);
      document.removeEventListener("change", onControlEvent, true);
      document.removeEventListener("click", onFinalClick, true);
      document.removeEventListener("focusout", onControlEvent, true);
      document.removeEventListener("submit", onSubmit, true);
      for (const control of nameErrors.keys()) clearNameError(control);
      for (const [control, previous] of preparedPhoneControls) {
        restoreAttribute(control, "inputmode", previous.inputMode);
        restoreAttribute(control, "placeholder", previous.placeholder);
      }
    };
  }

  // No customer values, passwords, consent values or URLs are sent by this channel.
  const checkoutEventCounts = new Map<string, number>();
  const seenPurchases = new WeakSet<object>();
  const purchaseAttempts = new WeakMap<object, number>();
  const purchaseStorageKey = `checkdrop:purchase-context:${site}`;
  function scanPurchases() {
    try {
      const layer = (window as unknown as { dataLayer?: unknown }).dataLayer;
      if (!Array.isArray(layer)) return;
      for (const value of layer.slice(-500)) {
        if (!value || typeof value !== "object" || seenPurchases.has(value)) continue;
        seenPurchases.add(value);
        // GA4 `purchase`, plus `purchase_velkoobchod` (Czech for wholesale) that some Czech shops
        // push for business orders; it is reported as the b2b channel.
        if (value.event !== "purchase" && value.event !== "purchase_velkoobchod") continue;
        const order = String(value.ecommerce?.transaction_id ?? "");
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(order)) continue;
        const stored = JSON.parse(sessionStorage.getItem(purchaseStorageKey) ?? "null");
        if (
          !stored ||
          typeof stored.form !== "string" ||
          !Number.isFinite(stored.at) ||
          Date.now() - stored.at > 86400000 ||
          stored.at > Date.now()
        )
          continue;
        const channel = value.event === "purchase_velkoobchod" ? "b2b" : "b2c";
        if (value.customer_type && value.customer_type !== channel) continue;
        const body = {
          event_id: crypto.randomUUID(),
          event: "purchase_reported",
          source: stored.source === "test" ? "test" : "customer",
          reason: "none",
          field: "none",
          context: "none",
          order_ref: order,
          purchase_channel: channel,
        };
        const attempts = (purchaseAttempts.get(value) ?? 0) + 1;
        purchaseAttempts.set(value, attempts);
        void post("checkout", "/v1/checkout/events", stored.form, body, {
          keepalive: true,
          signal: AbortSignal.timeout(2000),
        })
          .then((response) => {
            if (!response.ok && attempts < 3) seenPurchases.delete(value);
          })
          .catch(() => {
            if (attempts < 3) seenPurchases.delete(value);
          });
      }
    } catch {
      /* Never interfere with the shop or marketing dataLayer. */
    }
  }
  function recordCheckoutEvent(field: ConfiguredField | undefined, event: string, reason = "none") {
    if (!field) return;
    const count = checkoutEventCounts.get(field.form_id) ?? 0;
    if (count >= 200) return;
    checkoutEventCounts.set(field.form_id, count + 1);
    try {
      const eventId = crypto.randomUUID();
      const source =
        new URLSearchParams(location.search).get("checkdrop_test") === "1" ? "test" : "customer";
      if (event === "started" || event === "submit_attempt") {
        // Discard old queued purchases before attributing a new checkout.
        scanPurchases();
        try {
          sessionStorage.setItem(
            purchaseStorageKey,
            JSON.stringify({ form: field.form_id, at: Date.now(), source }),
          );
        } catch {
          /* Storage may be unavailable. */
        }
      }
      void post(
        "checkout",
        "/v1/checkout/events",
        field.form_id,
        {
          event_id: eventId,
          event,
          source,
          reason,
          field: [
            "customer_type",
            "profile_details_enabled",
            "alternate_shipping_enabled",
          ].includes(field.canonical_field)
            ? "unmapped"
            : field.canonical_field,
          context: field.context,
        },
        { keepalive: true, signal: AbortSignal.timeout(2000) },
      ).catch(() => {});
    } catch {
      /* Analytics must never interfere with checkout. */
    }
  }

  function observeCheckoutTracking(fields: readonly ConfiguredField[]) {
    const started = new Set<string>();
    const activityAt = new Map<string, number>();
    const attemptedAt = new Map<string, number>();
    const identify = (target: EventTarget | null) =>
      target instanceof Element && asValueControl(target)
        ? fields.find((field) =>
            safeMatchesWithin(
              asValueControl(target) as ValueControl,
              field.selector,
              field.root_selector,
            ),
          )
        : undefined;
    const start = (field: ConfiguredField) => {
      if (started.has(field.form_id)) return;
      started.add(field.form_id);
      activityAt.set(field.form_id, Date.now());
      recordCheckoutEvent(field, "started");
    };
    const input = (event: Event) => {
      const field = identify(event.target);
      if (
        !field ||
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement
        )
      )
        return;
      if (
        event.target instanceof HTMLInputElement &&
        ["password", "checkbox", "radio", "hidden"].includes(event.target.type)
      )
        return;
      if (addressMutationControls.has(event.target)) return;
      start(field);
      if (Date.now() - (activityAt.get(field.form_id) ?? 0) >= 30000) {
        activityAt.set(field.form_id, Date.now());
        recordCheckoutEvent(field, "activity");
      }
    };
    const attempt = (field: ConfiguredField) => {
      start(field);
      if (Date.now() - (attemptedAt.get(field.form_id) ?? 0) < 1000) return;
      attemptedAt.set(field.form_id, Date.now());
      recordCheckoutEvent(field, "submit_attempt");
    };
    const click = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target;
      const field = fields.find(
        (f) =>
          f.submit_selector &&
          elementInsideRoot(target, f.root_selector) &&
          target.closest(f.submit_selector),
      );
      if (field) attempt(field);
    };
    const submit = (event: Event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const form = event.target;
      const field = fields.find(
        (f) => firstControl(f.selector, f.root_selector)?.closest("form") === form,
      );
      if (!field) return;
      attempt(field);
      queueMicrotask(() => {
        if (checkdropBlockedEvents.has(event)) return;
        if (event.defaultPrevented) {
          // Nette exposes element references; never read/send its messages (which may contain values).
          const errors = (window as unknown as { Nette?: { formErrors?: { element?: unknown }[] } })
            .Nette?.formErrors;
          if (Array.isArray(errors)) {
            let found = false;
            for (const error of errors.slice(0, 16)) {
              if (!(error.element instanceof Element) || error.element.closest("form") !== form)
                continue;
              const invalidField = identify(error.element);
              if (invalidField) {
                found = true;
                recordCheckoutEvent(invalidField, "blocked", "shop_validation");
              }
            }
            if (found) return;
          }
        }
        // A prevented submit may be AJAX, not a failed order. Never count it as abandonment.
        recordCheckoutEvent(
          field,
          event.defaultPrevented ? "blocked" : "submit_dispatched",
          event.defaultPrevented ? "shop_cancelled" : "none",
        );
      });
    };
    const invalid = (event: Event) => {
      const field = identify(event.target);
      if (
        !field ||
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement ||
          event.target instanceof HTMLTextAreaElement
        )
      )
        return;
      attempt(field);
      recordCheckoutEvent(
        field,
        "blocked",
        event.target.validity.valueMissing ? "native_required" : "native_format",
      );
    };
    const left = () => {
      for (const formId of started)
        recordCheckoutEvent(
          fields.find((f) => f.form_id === formId),
          "page_left",
        );
    };
    document.addEventListener("input", input, true);
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    document.addEventListener("invalid", invalid, true);
    window.addEventListener("pagehide", left, true);
    return () => {
      document.removeEventListener("input", input, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
      document.removeEventListener("invalid", invalid, true);
      window.removeEventListener("pagehide", left, true);
    };
  }

  function schedule(
    formId: string,
    field: ConfiguredField,
    fields: readonly ConfiguredField[],
    control: ValueControl,
    value: string,
    delay: number,
  ) {
    if (!conditionMatches(field.condition_key, fields)) return;
    if (!value.trim() && field.canonical_field === "phone") return;
    if (!value.trim() && !field.required) return;
    const key = `${formId}:${field.context}:${field.canonical_field}`;
    const startedAt = timingNow();
    const previousTimer = timers.get(key);
    if (previousTimer) clearTimeout(previousTimer);
    timers.delete(key);
    const inFlight = activeRequests.get(key);
    if (inFlight && active.has(key) && inFlight.value === value) {
      const request = validationRequest(field, fields, value);
      // The same check for the same value is already on its way; restarting it would only
      // duplicate server work. A different value is never skipped: its answer must match it.
      if (request && JSON.stringify(request) === inFlight.fingerprint) return;
    }
    // A request whose answer confirms an offer the customer already acted on keeps running, so its
    // request_id can still be attached to the recorded choice.
    const awaited = inFlight ? emailOffers.get(control)?.get(inFlight.value) : undefined;
    if (!awaited || awaited.choice === "pending" || awaited.requestId) active.get(key)?.abort();
    const run = () => {
      timers.delete(key);
      void validate(formId, key, field, fields, control, value, startedAt);
    };
    if (delay > 0) timers.set(key, setTimeout(run, delay));
    else run();
  }

  async function validate(
    formId: string,
    key: string,
    field: ConfiguredField,
    fields: readonly ConfiguredField[],
    control: ValueControl,
    value: string,
    startedAt: number,
  ) {
    const request = validationRequest(field, fields, value);
    if (!request) return;
    const requestFingerprint = JSON.stringify(request);
    if (completedRequests.get(key) === requestFingerprint) return;
    const controller = new AbortController();
    active.set(key, controller);
    activeRequests.set(key, { fingerprint: requestFingerprint, value });
    let timed =
      field.validation_mode === "suggest" &&
      (field.canonical_field === "email" || field.canonical_field === "street_line");
    let outcome: AssistTimingOutcome = "unavailable";
    let requestMs: number | null = null;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 2_500);
    const requestStartedAt = timingNow();
    try {
      const response = await post("validation", request.path, formId, request.body, {
        keepalive: true,
        signal: controller.signal,
      });
      if (response.ok) completedRequests.set(key, requestFingerprint);
      requestMs = elapsedSince(requestStartedAt);
      if (response.ok) outcome = control.value === value ? "no_match" : "aborted";
      const localOffer =
        field.canonical_field === "email" ? emailOffers.get(control)?.get(value) : undefined;
      if (response.ok && localOffer) {
        // The instant offer was already on screen; only its confirmation is measured locally.
        timed = false;
        reconcileEmailOffer(formId, control, value, localOffer, (await response.json()) as unknown);
        return;
      }
      if (
        field.validation_mode === "suggest" &&
        [
          "email",
          "phone",
          "full_name",
          "first_name",
          "last_name",
          "street_line",
          "company_name",
          "company_id",
        ].includes(field.canonical_field) &&
        response.ok &&
        control.value === value
      ) {
        const result = (await response.json()) as unknown;
        requestMs = elapsedSince(requestStartedAt);
        if (
          field.canonical_field === "street_line" &&
          (controller.signal.aborted ||
            !conditionMatches(field.condition_key, fields) ||
            JSON.stringify(validationRequest(field, fields, control.value)) !== requestFingerprint)
        ) {
          outcome = "aborted";
          return;
        }
        const promptBefore = assistPrompts.get(control);
        const requestId = validationRequestId(result);
        if (field.canonical_field === "email") {
          const suggestion = safeEmailSuggestion(result);
          if (suggestion) {
            showCorrectionPrompt(
              control,
              value,
              suggestion,
              (event) => trackAssistInteraction(formId, requestId, event),
              "email",
            );
          } else {
            const warning = safeEmailWarning(result);
            // An unfinished address such as "jana@" is not an error while the customer is typing.
            const stillTyping =
              field.validation_trigger === "input" &&
              document.activeElement === control &&
              responseIssueCodes(
                result && typeof result === "object"
                  ? (result as { issues?: unknown }).issues
                  : null,
              ).includes("email.syntax_invalid");
            if (warning && !stillTyping) showAssistWarning(formId, control, warning, requestId);
          }
        } else if (field.canonical_field === "phone") {
          const suggestion =
            safePhoneSuggestion(result) ??
            (liveFormattedPhones.has(control) ? safeValidCzechPhone(result) : null);
          if (suggestion) applyPhoneNormalization(control, value, suggestion);
          else {
            const warning = safePhoneWarning(result);
            if (warning) showAssistWarning(formId, control, warning, requestId);
          }
        } else if (["full_name", "first_name", "last_name"].includes(field.canonical_field)) {
          // An older response for the other half must not erase a local required-name error.
          if (
            fields.some((candidate) => {
              if (
                !candidate.require_complete_name ||
                candidate.form_id !== field.form_id ||
                candidate.context !== field.context
              )
                return false;
              return (
                firstControl(candidate.selector, candidate.root_selector)?.getAttribute(
                  "aria-invalid",
                ) === "true"
              );
            })
          )
            return;
          if (
            field.require_complete_name &&
            (control.getAttribute("aria-invalid") === "true" ||
              nameRequirement(
                control.value,
                field.canonical_field === "full_name" ? "full" : "part",
              ))
          )
            return;
          const suggestion = safeNameSuggestion(result);
          clearRelatedNamePrompts(field, fields);
          if (acceptedNameValues.get(control) === control.value) {
            showNameOkay(control);
          } else if (suggestion && field.canonical_field === "full_name") {
            showCorrectionPrompt(
              control,
              value,
              suggestion,
              (event) => trackAssistInteraction(formId, requestId, event),
              "name",
            );
          } else {
            const warning = safeNameWarning(result);
            if (warning) showAssistWarning(formId, control, warning, requestId);
            else if (safeNameOkay(result)) showNameOkay(control);
          }
        } else if (["company_name", "company_id"].includes(field.canonical_field)) {
          const company = safeConfirmedCompany(result);
          if (company) {
            applyCompanyData(formId, fields, control, company, requestId);
          } else {
            const companies = safeCompanySuggestions(result);
            // A slower answer for an earlier, shorter IČO must not cover the finished one.
            if (control.value !== value) return;
            if (companies.length > 0) {
              showCompanySuggestions(formId, fields, control, value, companies);
            } else {
              const warning = safeCompanyWarning(result);
              if (warning) showAssistWarning(formId, control, warning, requestId);
            }
          }
        } else {
          const answer = { value, formId, field, fields, result, requestId };
          addressAnswers.set(control, answer);
          // While the customer types in the street, hints stay neutral; warnings wait for blur.
          renderAddressAnswer(control, answer, document.activeElement === control);
        }
        const promptAfter = assistPrompts.get(control);
        outcome =
          promptAfter && promptAfter !== promptBefore && promptAfter.isConnected
            ? "shown"
            : "no_match";
      }
    } catch {
      // Checkdrop is always fail-open. A checkout continues without an assist prompt.
      outcome = controller.signal.aborted && !timedOut ? "aborted" : "unavailable";
    } finally {
      clearTimeout(timeout);
      if (active.get(key) === controller) {
        active.delete(key);
        activeRequests.delete(key);
      }
      if (timed) reportAssistTiming(field, startedAt, requestMs, outcome);
    }
  }

  function showInstantEmailOffer(
    formId: string,
    field: ConfiguredField,
    control: ValueControl,
    startedAt: number,
  ) {
    const offers = offersFor(control);
    if (offers.get(control.value)?.choice === "pending") return;
    for (const offer of offers.values())
      if (offer.choice === "pending") dropEmailOffer(control, offer.original);
    const parts = parseEmail(control.value);
    const target = parts ? instantCorrections[parts.domain] : undefined;
    if (!parts || !target || target === parts.domain) return;
    const offer: EmailOffer = {
      original: control.value,
      suggestion: `${parts.local}@${target}`,
      requestId: null,
      choice: "pending",
      events: [],
      dropTimer: undefined,
    };
    offers.set(offer.original, offer);
    offer.dropTimer = setTimeout(() => {
      if (!offer.requestId) offer.events = [];
      if (offer.choice !== "pending") offers.delete(offer.original);
    }, 5_000);
    showCorrectionPrompt(
      control,
      offer.original,
      offer.suggestion,
      (event) => {
        if (event !== "shown") offer.choice = event;
        if (offer.requestId) trackAssistInteraction(formId, offer.requestId, event);
        else if (offer.events.length < 4) offer.events.push(event);
      },
      "email",
    );
    const prompt = assistPrompts.get(control);
    if (prompt?.isConnected) reportAssistTiming(field, startedAt, null, "shown", "local");
  }

  function dropEmailOffer(control: ValueControl, original: string) {
    const offers = emailOffers.get(control);
    const offer = offers?.get(original);
    if (offer) clearTimeout(offer.dropTimer);
    offers?.delete(original);
  }

  function reconcileEmailOffer(
    formId: string,
    control: ValueControl,
    value: string,
    offer: EmailOffer,
    result: unknown,
  ) {
    const suggestion = safeEmailSuggestion(result);
    const requestId = validationRequestId(result);
    const status =
      result && typeof result === "object" ? (result as { status?: unknown }).status : null;
    if (suggestion === offer.suggestion) {
      if (!requestId || offer.requestId) return;
      offer.requestId = requestId;
      for (const event of offer.events.splice(0)) trackAssistInteraction(formId, requestId, event);
      if (offer.choice !== "pending") dropEmailOffer(control, offer.original);
      return;
    }
    // A customer's choice is never overwritten by a later answer.
    if (offer.choice !== "pending" || control.value !== value) return;
    if (suggestion) {
      dropEmailOffer(control, offer.original);
      showCorrectionPrompt(
        control,
        value,
        suggestion,
        (event) => trackAssistInteraction(formId, requestId, event),
        "email",
      );
    } else if (status === "valid" || status === "risky") {
      // The typed domain works after all, so the instant offer is withdrawn.
      dropEmailOffer(control, offer.original);
      clearAssistPrompt(control);
      const warning = safeEmailWarning(result);
      if (warning) showAssistWarning(formId, control, warning, requestId);
    }
  }

  // Address search answers while the customer is still typing; other fields wait longer.
  function inputDelay(field: ConfiguredField) {
    return field.canonical_field === "street_line" ? 200 : 450;
  }

  type AssistTimingOutcome = "shown" | "no_match" | "unavailable" | "aborted";

  function timingNow() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function elapsedSince(start: number) {
    return Math.round((timingNow() - start) * 10) / 10;
  }

  // Local diagnostics only: a DOM event without field values or identifiers, never sent anywhere.
  // "shown" is reported after the next frame, so it includes the browser's layout and paint.
  function reportAssistTiming(
    field: ConfiguredField,
    startedAt: number,
    requestMs: number | null,
    outcome: AssistTimingOutcome,
    source: "api" | "local" = "api",
  ) {
    const emit = (inputToRenderMs: number | null) => {
      try {
        document.dispatchEvent(
          new CustomEvent("checkdrop:assist-timing", {
            detail: {
              field: field.canonical_field,
              context: field.context,
              source,
              outcome,
              inputToRenderMs,
              requestMs,
            },
          }),
        );
      } catch {
        // Measurement must never affect the checkout.
      }
    };
    try {
      if (outcome !== "shown") {
        emit(null);
        return;
      }
      const afterPaint = () => setTimeout(() => emit(elapsedSince(startedAt)), 0);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(afterPaint);
      else afterPaint();
    } catch {
      // Measurement must never affect the checkout.
    }
  }

  function safeEmailSuggestion(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const result = value as {
      status?: unknown;
      action?: unknown;
      suggestion?: unknown;
      issues?: unknown;
    };
    const hasTypoIssue = Array.isArray(result.issues)
      ? result.issues.some(
          (issue) =>
            Boolean(issue) &&
            typeof issue === "object" &&
            (issue as { code?: unknown }).code === "email.domain_typo",
        )
      : false;
    return result.status === "correctable" &&
      result.action === "suggest" &&
      hasTypoIssue &&
      typeof result.suggestion === "string" &&
      result.suggestion.length <= 320
      ? result.suggestion
      : null;
  }

  function safeNameSuggestion(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const result = value as {
      status?: unknown;
      action?: unknown;
      suggestion?: unknown;
      issues?: unknown;
    };
    const safeNormalizationCodes = new Set([
      "person.whitespace_normalized",
      "person.trailing_punctuation",
      "person.title_normalized",
      "person.capitalization_normalized",
      "person.initial_spacing_normalized",
    ]);
    const issueCodes = responseIssueCodes(result.issues);
    return result.status === "correctable" &&
      result.action === "suggest" &&
      issueCodes.length > 0 &&
      issueCodes.every((code) => safeNormalizationCodes.has(code)) &&
      typeof result.suggestion === "string" &&
      result.suggestion.length > 2 &&
      result.suggestion.length <= 240
      ? result.suggestion
      : null;
  }

  function safeNameWarning(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const result = value as { status?: unknown; action?: unknown; issues?: unknown };
    if (!["invalid", "risky"].includes(String(result.status)) || result.action !== "warn") {
      return null;
    }
    const issueCodes = responseIssueCodes(result.issues);
    if (
      issueCodes.includes("person.full_name_missing") ||
      issueCodes.includes("person.full_name_incomplete")
    ) {
      return message("name.incomplete");
    }
    if (issueCodes.includes("person.company_name_in_contact")) {
      return message("name.company_in_contact");
    }
    if (
      issueCodes.includes("person.invalid_characters") ||
      issueCodes.includes("person.separator_invalid")
    ) {
      return message("name.invalid_characters");
    }
    if (issueCodes.includes("person.capitalization_ambiguous")) {
      return message("name.capitalization");
    }
    return null;
  }

  function safeNameOkay(value: unknown) {
    if (!value || typeof value !== "object") return false;
    const result = value as { status?: unknown; action?: unknown };
    return result.status === "valid" && result.action === "accept";
  }

  type CompanyAssistData = {
    ico: string;
    name: string;
    vatId: string | null;
    address: string | null;
    registeredOffice: {
      streetLine: string | null;
      city: string | null;
      postalCode: string | null;
      country: "CZ";
    } | null;
  };

  function safeConfirmedCompany(value: unknown): CompanyAssistData | null {
    if (!value || typeof value !== "object") return null;
    const result = value as { status?: unknown; company?: unknown };
    return ["valid", "correctable"].includes(String(result.status))
      ? safeCompany(result.company)
      : null;
  }

  function safeCompanySuggestions(value: unknown): readonly CompanyAssistData[] {
    if (!value || typeof value !== "object") return [];
    const result = value as { status?: unknown; suggestions?: unknown };
    if (result.status !== "matched" || !Array.isArray(result.suggestions)) return [];
    return result.suggestions
      .slice(0, 5)
      .map(safeCompany)
      .filter((company): company is CompanyAssistData => company !== null);
  }

  function safeCompany(value: unknown): CompanyAssistData | null {
    if (!value || typeof value !== "object") return null;
    const company = value as {
      ico?: unknown;
      name?: unknown;
      vat_id?: unknown;
      address?: unknown;
      registered_office?: unknown;
    };
    if (!safeAssistText(company.ico, 8) || !/^\d{8}$/.test(company.ico)) return null;
    if (!safeAssistText(company.name, 512)) return null;
    const office = company.registered_office;
    let registeredOffice: CompanyAssistData["registeredOffice"] = null;
    if (office && typeof office === "object") {
      const data = office as {
        street_line?: unknown;
        city?: unknown;
        postal_code?: unknown;
        country?: unknown;
      };
      if (data.country === "CZ") {
        registeredOffice = {
          streetLine:
            data.street_line === null || safeAssistText(data.street_line, 240)
              ? (data.street_line as string | null)
              : null,
          city:
            data.city === null || safeAssistText(data.city, 240)
              ? (data.city as string | null)
              : null,
          postalCode:
            typeof data.postal_code === "string" && /^\d{5}$/.test(data.postal_code)
              ? data.postal_code.replace(/^(\d{3})(\d{2})$/, "$1 $2")
              : null,
          country: "CZ",
        };
      }
    }
    return {
      ico: company.ico,
      name: company.name,
      vatId:
        company.vat_id === null || safeAssistText(company.vat_id, 32)
          ? (company.vat_id as string | null)
          : null,
      address:
        company.address === null || safeAssistText(company.address, 1_024)
          ? (company.address as string | null)
          : null,
      registeredOffice,
    };
  }

  function safeCompanyWarning(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const result = value as { status?: unknown; issues?: unknown };
    const codes = responseIssueCodes(result.issues);
    if (result.status === "invalid") return message("company.id_invalid");
    if (codes.includes("company.ares_not_found")) return message("company.not_found");
    return null;
  }

  function showNameOkay(control: ValueControl) {
    clearAssistPrompt(control);
    if (!control.isConnected) return;
    installAssistPromptStyles();
    const status = document.createElement("span");
    status.className = "checkdrop-name-ok";
    status.setAttribute("role", "status");
    status.setAttribute("aria-label", message("name.ok"));
    status.textContent = "✓";
    insertAssistElement(control, status);
    assistPrompts.set(control, status);
  }

  type AddressAssistSuggestion = {
    id: string;
    label: string;
    streetLine: string;
    city: string;
    postalCode: string;
  };

  function safeAddressSuggestions(value: unknown): readonly AddressAssistSuggestion[] {
    if (!value || typeof value !== "object") return [];
    const result = value as { status?: unknown; suggestions?: unknown };
    if (result.status !== "matched" || !Array.isArray(result.suggestions)) return [];
    return result.suggestions.slice(0, 5).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const suggestion = candidate as {
        id?: unknown;
        label?: unknown;
        street_line?: unknown;
        city?: unknown;
        postal_code?: unknown;
      };
      if (
        !safeAssistText(suggestion.id, 64) ||
        !safeAssistText(suggestion.label, 320) ||
        !safeAssistText(suggestion.street_line, 200) ||
        !safeAssistText(suggestion.city, 160) ||
        typeof suggestion.postal_code !== "string" ||
        !/^\d{5}$/.test(suggestion.postal_code)
      ) {
        return [];
      }
      return [
        {
          id: suggestion.id,
          label: suggestion.label,
          streetLine: suggestion.street_line,
          city: suggestion.city,
          postalCode: suggestion.postal_code.replace(/^(\d{3})(\d{2})$/, "$1 $2"),
        },
      ];
    });
  }

  // Only known codes and a five-digit PSČ are accepted; server text is never rendered.
  function safeAddressAdvice(value: unknown): { code: string; postalCode: string | null } | null {
    if (!value || typeof value !== "object") return null;
    const advice = (value as { advice?: unknown }).advice;
    if (!advice || typeof advice !== "object") return null;
    const code = (advice as { code?: unknown }).code;
    const postalCode = (advice as { postal_code?: unknown }).postal_code;
    if (code === "address.postal_code_mismatch")
      return typeof postalCode === "string" && /^\d{5}$/.test(postalCode)
        ? { code, postalCode }
        : null;
    return code === "address.house_number_missing" ||
      code === "address.no_match" ||
      code === "address.country_mismatch"
      ? { code, postalCode: null }
      : null;
  }

  function safeAddressWarning(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const status = (value as { status?: unknown }).status;
    return status === "no_match" ? deliveryAddressWarning : null;
  }

  function safeAssistText(value: unknown, maximumLength: number): value is string {
    const hasControlCharacters =
      typeof value === "string" &&
      [...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127;
      });
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximumLength &&
      !hasControlCharacters
    );
  }

  function responseIssueCodes(value: unknown): string[] {
    return Array.isArray(value)
      ? value.flatMap((issue) =>
          issue &&
          typeof issue === "object" &&
          typeof (issue as { code?: unknown }).code === "string"
            ? [(issue as { code: string }).code]
            : [],
        )
      : [];
  }

  function safePhoneSuggestion(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const result = value as {
      status?: unknown;
      action?: unknown;
      normalized?: unknown;
      issues?: unknown;
    };
    const hasNormalizedIssue = Array.isArray(result.issues)
      ? result.issues.some(
          (issue) =>
            Boolean(issue) &&
            typeof issue === "object" &&
            (issue as { code?: unknown }).code === "phone.normalized",
        )
      : false;
    if (
      result.status !== "correctable" ||
      result.action !== "suggest" ||
      !hasNormalizedIssue ||
      typeof result.normalized !== "string" ||
      !/^\+420\d{9}$/.test(result.normalized)
    ) {
      return null;
    }
    return result.normalized.replace(/^(\+420)(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4");
  }

  function validationRequestId(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const requestId = (value as { request_id?: unknown }).request_id;
    return typeof requestId === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)
      ? requestId
      : null;
  }

  function safeValidCzechPhone(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const result = value as { status?: unknown; action?: unknown; normalized?: unknown };
    return result.status === "valid" &&
      result.action === "accept" &&
      typeof result.normalized === "string" &&
      /^\+420\d{9}$/.test(result.normalized)
      ? result.normalized.replace(/^(\+420)(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4")
      : null;
  }

  function safeEmailWarning(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const result = value as { status?: unknown; action?: unknown; issues?: unknown };
    if (result.status !== "invalid" || result.action !== "warn" || !Array.isArray(result.issues)) {
      return null;
    }
    const issueCodes = result.issues.flatMap((issue) =>
      issue && typeof issue === "object" && typeof (issue as { code?: unknown }).code === "string"
        ? [(issue as { code: string }).code]
        : [],
    );
    if (issueCodes.includes("email.syntax_invalid")) return message("email.syntax_invalid");
    if (issueCodes.includes("email.domain_no_dns")) {
      return message("email.domain_no_dns");
    }
    return null;
  }

  function safePhoneWarning(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const result = value as { status?: unknown; action?: unknown; issues?: unknown };
    if (result.action !== "warn" || !Array.isArray(result.issues)) return null;
    const issueCodes = result.issues.flatMap((issue) =>
      issue && typeof issue === "object" && typeof (issue as { code?: unknown }).code === "string"
        ? [(issue as { code: string }).code]
        : [],
    );
    if (result.status === "invalid" && issueCodes.includes("phone.number_impossible")) {
      return message("phone.impossible");
    }
    if (result.status === "risky" && issueCodes.includes("phone.country_not_cz")) {
      return message("phone.foreign");
    }
    return null;
  }

  function showCorrectionPrompt(
    control: ValueControl,
    original: string,
    suggestion: string,
    track: (event: AssistEvent) => void,
    kind: "email" | "name",
  ) {
    clearAssistPrompt(control);
    if (original === suggestion || !control.isConnected) return;
    installAssistPromptStyles();
    const prompt = document.createElement("div");
    prompt.className = "checkdrop-field-assist";
    prompt.setAttribute("role", "status");
    prompt.setAttribute("aria-live", "polite");
    const icon = assistIcon("?");
    const copy = document.createElement("span");
    copy.className = "checkdrop-field-assist-copy";
    const fieldLabel = message(kind === "email" ? "field.email" : "field.name");
    copy.textContent = kind === "email" ? message("correction.question_prefix_email") : "";
    copy.title = message("correction.title", { field: fieldLabel, value: suggestion });
    const value = document.createElement("strong");
    value.textContent =
      kind === "email" ? suggestion.slice(suggestion.lastIndexOf("@") + 1) : suggestion;
    copy.append(value, message("correction.question_suffix"));
    const actions = document.createElement("span");
    actions.className = "checkdrop-field-assist-actions";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = message("correction.apply");
    apply.setAttribute(
      "aria-label",
      message("correction.apply_label", { field: fieldLabel, value: suggestion }),
    );
    apply.addEventListener("click", () => {
      if (control.value !== original) return;
      if (kind === "name") acceptedNameValues.set(control, suggestion);
      // Record the choice first: changing the value drops offers that still look undecided.
      track("applied");
      setNativeControlValue(control, suggestion);
      clearAssistPrompt(control);
      if (kind === "name") showNameOkay(control);
    });
    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "checkdrop-field-assist-keep";
    keep.textContent = message("correction.keep");
    keep.setAttribute("aria-label", message("correction.keep_label", { field: fieldLabel }));
    keep.addEventListener("click", () => {
      if (control.value !== original) return;
      if (kind === "name") acceptedNameValues.set(control, original);
      track("kept");
      clearAssistPrompt(control);
      if (kind === "name") showNameOkay(control);
    });
    actions.append(apply, keep);
    prompt.append(icon, copy, actions);
    insertAssistElement(control, prompt);
    assistPrompts.set(control, prompt);
    track("shown");
  }

  function showCompanySuggestions(
    formId: string,
    fields: readonly ConfiguredField[],
    control: ValueControl,
    original: string,
    companies: readonly CompanyAssistData[],
  ) {
    clearAssistPrompt(control);
    if (!control.isConnected || control.value !== original || companies.length === 0) return;
    installAssistPromptStyles();
    const panel = document.createElement("div");
    panel.className = "checkdrop-address-assist";
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-label", message("company.suggestions_label"));
    const title = document.createElement("span");
    title.className = "checkdrop-address-assist-title";
    title.textContent = message("company.pick");
    const list = document.createElement("span");
    list.className = "checkdrop-address-assist-list";
    for (const company of companies) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "checkdrop-address-assist-option";
      option.setAttribute("role", "option");
      option.textContent = `${company.name} · IČO ${company.ico}${company.address ? ` · ${company.address}` : ""}`;
      option.addEventListener("click", () => {
        if (control.value !== original) return;
        clearAssistPrompt(control);
        void confirmAndApplyCompany(formId, fields, control, company.ico);
      });
      list.append(option);
    }
    panel.append(title, list);
    insertAssistElement(control, panel);
    assistPrompts.set(control, panel);
    bindAutocomplete(control, panel);
  }

  async function confirmAndApplyCompany(
    formId: string,
    fields: readonly ConfiguredField[],
    control: ValueControl,
    ico: string,
  ) {
    const original = control.value;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await post(
        "validation",
        "/v1/company-ids/validate",
        formId,
        { company_id: ico, country: "CZ" },
        { signal: controller.signal },
      );
      if (!response.ok) return;
      const result = (await response.json()) as unknown;
      const company = safeConfirmedCompany(result);
      if (company && control.isConnected && control.value === original) {
        applyCompanyData(formId, fields, control, company, validationRequestId(result));
      }
    } catch {
      // ARES is fail-open and never blocks the form.
    } finally {
      clearTimeout(timeout);
    }
  }

  function applyCompanyData(
    formId: string,
    fields: readonly ConfiguredField[],
    control: ValueControl,
    company: CompanyAssistData,
    requestId: string | null,
  ) {
    clearAssistPrompt(control);
    if (!control.isConnected) return;
    const office = company.registeredOffice;
    const proposed: readonly { canonicalField: string; value: string | null; context: string }[] = [
      { canonicalField: "company_name", value: company.name, context: "company" },
      { canonicalField: "company_name", value: company.name, context: "billing" },
      { canonicalField: "company_id", value: company.ico, context: "company" },
      { canonicalField: "company_id", value: company.ico, context: "billing" },
      { canonicalField: "vat_id", value: company.vatId, context: "company" },
      { canonicalField: "vat_id", value: company.vatId, context: "billing" },
      { canonicalField: "street_line", value: office?.streetLine ?? null, context: "billing" },
      { canonicalField: "street_line", value: office?.streetLine ?? null, context: "company" },
      { canonicalField: "city", value: office?.city ?? null, context: "billing" },
      { canonicalField: "city", value: office?.city ?? null, context: "company" },
      { canonicalField: "postal_code", value: office?.postalCode ?? null, context: "billing" },
      { canonicalField: "postal_code", value: office?.postalCode ?? null, context: "company" },
      { canonicalField: "country", value: office?.country ?? null, context: "billing" },
      { canonicalField: "country", value: office?.country ?? null, context: "company" },
    ];
    const changes: {
      control: ValueControl;
      original: string;
      applied: string;
      canonicalField: string;
    }[] = [];
    const changedControls = new Set<ValueControl>();
    for (const candidate of proposed) {
      if (!candidate.value) continue;
      const mapped = findExactField(fields, candidate.canonicalField, candidate.context);
      if (!mapped || mapped.context === "shipping") continue;
      const mappedControl = firstControl(mapped.selector, mapped.root_selector);
      if (!mappedControl || changedControls.has(mappedControl)) continue;
      const applied =
        mapped.canonical_field === "country"
          ? countryControlValue(mappedControl, candidate.value)
          : candidate.value;
      if (!applied || mappedControl.value === applied) continue;
      changes.push({
        control: mappedControl,
        original: mappedControl.value,
        applied,
        canonicalField: mapped.canonical_field,
      });
      changedControls.add(mappedControl);
    }
    for (const change of changes) setAddressControlValue(change.control, change.applied);
    // Nothing to change still deserves an answer: the form already matches the register.
    if (changes.length === 0) {
      showConfirmedCompany(control, company.name);
      return;
    }
    showAppliedCompany(formId, control, company.name, changes, requestId);
    const changedFields = changes.map((change) => change.canonicalField);
    trackAssistInteraction(formId, requestId, "shown", undefined, changedFields);
    trackAssistInteraction(formId, requestId, "applied", company.name, changedFields);
  }

  function showConfirmedCompany(control: ValueControl, companyName: string) {
    installAssistPromptStyles();
    const prompt = document.createElement("div");
    prompt.className = "checkdrop-field-assist checkdrop-field-assist-applied";
    prompt.setAttribute("role", "status");
    prompt.setAttribute("aria-live", "polite");
    const copy = document.createElement("span");
    copy.className = "checkdrop-field-assist-copy";
    copy.textContent = message("company.confirmed");
    copy.title = companyName;
    prompt.append(assistIcon("✓"), copy);
    insertAssistElement(control, prompt);
    assistPrompts.set(control, prompt);
  }

  function showAppliedCompany(
    formId: string,
    control: ValueControl,
    companyName: string,
    changes: readonly {
      control: ValueControl;
      original: string;
      applied: string;
      canonicalField: string;
    }[],
    requestId: string | null,
  ) {
    installAssistPromptStyles();
    const prompt = document.createElement("div");
    prompt.className = "checkdrop-field-assist checkdrop-field-assist-applied";
    prompt.setAttribute("role", "status");
    prompt.setAttribute("aria-live", "polite");
    const icon = assistIcon("✓");
    const copy = document.createElement("span");
    copy.className = "checkdrop-field-assist-copy";
    copy.textContent = message("company.filled");
    copy.title = companyName;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "checkdrop-field-assist-undo";
    undo.textContent = message("undo");
    undo.addEventListener("click", () => {
      for (const change of changes) {
        if (change.control.value === change.applied) {
          setAddressControlValue(change.control, change.original);
        }
      }
      trackAssistInteraction(
        formId,
        requestId,
        "undone",
        undefined,
        changes.map((change) => change.canonicalField),
      );
      clearAssistPrompt(control);
    });
    prompt.append(icon, copy, undo);
    insertAssistElement(control, prompt);
    assistPrompts.set(control, prompt);
  }

  function countryControlValue(control: ValueControl, country: string) {
    if (!(control instanceof HTMLSelectElement)) return country;
    const option = Array.from(control.options).find((candidate) =>
      [candidate.value, candidate.textContent ?? ""]
        .map(normalizeLookup)
        .some((value) => ["cz", "cze", "cesko", "ceska republika"].includes(value)),
    );
    return option?.value ?? null;
  }

  function renderAddressAnswer(control: ValueControl, answer: AddressAnswer, typing: boolean) {
    const { value, formId, field, fields, result, requestId } = answer;
    const suggestions = safeAddressSuggestions(result);
    const advice = safeAddressAdvice(result);
    if (suggestions.length > 0) {
      showAddressSuggestions(
        formId,
        field,
        fields,
        control,
        value,
        suggestions,
        requestId,
        typing
          ? { text: addressTypingTitle, warning: false }
          : {
              text:
                advice?.code === "address.postal_code_mismatch" && advice.postalCode
                  ? message("address.postal_code_mismatch", {
                      postal_code: `${advice.postalCode.slice(0, 3)} ${advice.postalCode.slice(3)}`,
                    })
                  : advice?.code === "address.house_number_missing"
                    ? houseNumberMissingWarning
                    : deliveryAddressWarning,
              warning: true,
            },
      );
    } else if (!typing) {
      // With a domestic-only PSČ the warning sits there; the street stays quiet to avoid a duplicate.
      const domesticGuarded = fields.some(
        (candidate) =>
          candidate.require_domestic_address === true &&
          candidate.canonical_field === "postal_code" &&
          candidate.context === field.context,
      );
      const warning =
        advice?.code === "address.country_mismatch"
          ? domesticGuarded
            ? null
            : addressNotVerifiedWarning
          : advice?.code === "address.no_match"
            ? addressNotVerifiedWarning
            : advice?.code === "address.house_number_missing"
              ? houseNumberMissingWarning
              : advice
                ? null
                : safeAddressWarning(result);
      if (warning) showAssistWarning(formId, control, warning, requestId);
    }
  }

  function showAddressSuggestions(
    formId: string,
    field: ConfiguredField,
    fields: readonly ConfiguredField[],
    control: ValueControl,
    original: string,
    suggestions: readonly AddressAssistSuggestion[],
    requestId: string | null,
    heading: { text: string; warning: boolean } = { text: deliveryAddressWarning, warning: true },
  ) {
    clearAssistPrompt(control);
    if (
      !control.isConnected ||
      control.value !== original ||
      suggestions.length === 0 ||
      control.matches(":disabled") ||
      control.getClientRects().length === 0 ||
      control.closest("[hidden], [inert]") ||
      getComputedStyle(control).visibility === "hidden"
    )
      return;
    installAssistPromptStyles();
    const panel = document.createElement("div");
    panel.className = "checkdrop-address-assist";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", message("address.suggestions_label"));
    const title = document.createElement("span");
    title.className = heading.warning
      ? "checkdrop-address-assist-title checkdrop-address-assist-warning"
      : "checkdrop-address-assist-title";
    title.textContent = heading.text;
    const list = document.createElement("span");
    list.className = "checkdrop-address-assist-list";
    const cityField = fields.find(
      (candidate) => candidate.canonical_field === "city" && candidate.context === field.context,
    );
    const postalCodeField = fields.find(
      (candidate) =>
        candidate.canonical_field === "postal_code" && candidate.context === field.context,
    );
    const cityControl = cityField
      ? firstControl(cityField.selector, cityField.root_selector)
      : null;
    const postalCodeControl = postalCodeField
      ? firstControl(postalCodeField.selector, postalCodeField.root_selector)
      : null;
    if (
      suggestions.some(
        (suggestion) =>
          normalizeLookup(original) === normalizeLookup(suggestion.streetLine) &&
          cityControl &&
          normalizeLookup(cityControl.value) === normalizeLookup(suggestion.city) &&
          postalCodeControl &&
          postalCodeControl.value.replace(/\s/g, "") === suggestion.postalCode.replace(/\s/g, ""),
      )
    )
      return;
    for (const suggestion of suggestions) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "checkdrop-address-assist-option";
      option.textContent = suggestion.label;
      option.addEventListener("click", () => {
        if (control.value !== original) return;
        const values = [
          { control, original: control.value, applied: suggestion.streetLine },
          ...(cityControl
            ? [{ control: cityControl, original: cityControl.value, applied: suggestion.city }]
            : []),
          ...(postalCodeControl
            ? [
                {
                  control: postalCodeControl,
                  original: postalCodeControl.value,
                  applied: suggestion.postalCode,
                },
              ]
            : []),
        ].filter((candidate) => candidate.original !== candidate.applied);
        for (const value of values) setAddressControlValue(value.control, value.applied);
        trackAssistInteraction(
          formId,
          requestId,
          "applied",
          suggestion.label,
          values.map((candidate) =>
            candidate.control === control
              ? "street_line"
              : candidate.control === cityControl
                ? "city"
                : "postal_code",
          ),
        );
        showAppliedAddress(formId, control, suggestion.label, values, requestId);
      });
      list.append(option);
    }
    panel.append(title, list);
    insertAssistElement(control, panel);
    assistPrompts.set(control, panel);
    bindAutocomplete(control, panel, () => {
      if (control.value === original) {
        showAssistWarning(formId, control, deliveryAddressWarning, requestId);
      }
    });
    trackAssistInteraction(formId, requestId, "shown");
  }

  function showAppliedAddress(
    formId: string,
    control: ValueControl,
    label: string,
    values: readonly { control: ValueControl; original: string; applied: string }[],
    requestId: string | null,
  ) {
    clearAssistPrompt(control);
    if (!control.isConnected) return;
    installAssistPromptStyles();
    const prompt = document.createElement("div");
    prompt.className = "checkdrop-field-assist checkdrop-field-assist-applied";
    prompt.setAttribute("role", "status");
    prompt.setAttribute("aria-live", "polite");
    const icon = assistIcon("✓");
    const copy = document.createElement("span");
    copy.className = "checkdrop-field-assist-copy";
    copy.textContent = message("address.filled");
    copy.title = label;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "checkdrop-field-assist-undo";
    undo.textContent = message("undo");
    undo.setAttribute("aria-label", message("address.undo_label"));
    undo.addEventListener("click", () => {
      for (const value of values) {
        if (value.control.value === value.applied) {
          setAddressControlValue(value.control, value.original);
        }
      }
      trackAssistInteraction(formId, requestId, "undone");
      clearAssistPrompt(control);
    });
    prompt.append(icon, copy, undo);
    insertAssistElement(control, prompt);
    assistPrompts.set(control, prompt);
  }

  function setAddressControlValue(control: ValueControl, value: string) {
    if (control.value === value) return;
    addressMutationControls.add(control);
    try {
      setNativeControlValue(control, value);
    } finally {
      addressMutationControls.delete(control);
    }
  }

  function applyPhoneNormalization(control: ValueControl, original: string, normalized: string) {
    clearAssistPrompt(control);
    if (!control.isConnected || control.value !== original) return;
    liveFormattedPhones.delete(control);
    if (control.value !== normalized) setNativeControlValue(control, normalized);
  }

  function trackAssistInteraction(
    formId: string,
    requestId: string | null,
    event: "shown" | "applied" | "kept" | "undone",
    proposedValue?: string,
    changedFields?: readonly string[],
  ) {
    if (!requestId) return;
    const previous = assistTrackingQueues.get(requestId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        await post(
          "assist",
          "/v1/assist/interactions",
          formId,
          {
            request_id: requestId,
            event,
            ...(proposedValue ? { proposed_value: proposedValue } : {}),
            ...(changedFields && changedFields.length > 0 ? { changed_fields: changedFields } : {}),
          },
          { keepalive: true },
        );
      })
      .catch(() => {
        // Tracking must never affect the checkout or the chosen value.
      });
    assistTrackingQueues.set(requestId, next);
    void next.finally(() => {
      if (assistTrackingQueues.get(requestId) === next) assistTrackingQueues.delete(requestId);
    });
  }

  function preparePhoneControl(
    control: ValueControl,
    prepared: Map<ValueControl, { inputMode: string | null; placeholder: string | null }>,
  ) {
    if (prepared.has(control)) return;
    prepared.set(control, {
      inputMode: control.getAttribute("inputmode"),
      placeholder: control.getAttribute("placeholder"),
    });
    control.setAttribute("inputmode", "tel");
    control.setAttribute("placeholder", texts.phonePlaceholder);
  }

  function formatCzechPhoneControl(control: ValueControl) {
    if (!(control instanceof HTMLInputElement)) return;
    const raw = control.value.trim();
    if (!raw) return;
    if (isCzechPhonePrefixOnly(raw)) {
      setControlValueSilently(control, "");
      return;
    }
    const digits = raw.replace(/\D/g, "");
    if (raw.startsWith("+") && digits.length >= 3 && !digits.startsWith("420")) return;
    const national = digits.startsWith("420") ? digits.slice(3) : digits;
    if (national.length > 9) return;
    const grouped = national.replace(/(\d{3})(?=\d)/g, "$1 ");
    const formatted = `+420${grouped ? ` ${grouped}` : ""}`;
    if (formatted === control.value) return;
    setControlValueSilently(control, formatted);
    control.setSelectionRange(formatted.length, formatted.length);
    if (national.length > 0) liveFormattedPhones.add(control);
  }

  function isCzechPhonePrefixOnly(value: string) {
    return /^\+(?:4(?:2(?:0)?)?)?\s*$/.test(value);
  }

  function restoreAttribute(control: ValueControl, name: string, previous: string | null) {
    if (previous === null) control.removeAttribute(name);
    else control.setAttribute(name, previous);
  }

  function showAssistWarning(
    formId: string,
    control: ValueControl,
    message: string,
    requestId: string | null,
  ) {
    clearAssistPrompt(control);
    if (
      !control.isConnected ||
      control.matches(":disabled") ||
      control.getClientRects().length === 0 ||
      control.closest("[hidden], [inert]") ||
      getComputedStyle(control).visibility === "hidden"
    )
      return;
    installAssistPromptStyles();
    const warning = document.createElement("div");
    warning.className = "checkdrop-field-assist checkdrop-field-assist-warning";
    warning.setAttribute("role", "alert");
    warning.setAttribute("aria-live", "assertive");
    const icon = assistIcon("!");
    const copy = document.createElement("span");
    copy.className = "checkdrop-field-assist-copy";
    copy.textContent = message;
    warning.append(icon, copy);
    insertAssistElement(control, warning);
    assistPrompts.set(control, warning);
    trackAssistInteraction(formId, requestId, "shown");
  }

  function assistIcon(symbol: string) {
    const icon = document.createElement("span");
    icon.className = "checkdrop-field-assist-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = symbol;
    return icon;
  }

  function bindAutocomplete(control: ValueControl, panel: HTMLElement, onDismiss?: () => void) {
    if (!(control instanceof HTMLElement)) return;
    const attributes = [
      "role",
      "aria-autocomplete",
      "aria-expanded",
      "aria-controls",
      "aria-activedescendant",
    ];
    const previous = attributes.map((name) => [name, control.getAttribute(name)] as const);
    panel.id = `checkdrop-options-${crypto.randomUUID()}`;
    panel.setAttribute("role", "listbox");
    const options = Array.from(
      panel.querySelectorAll<HTMLButtonElement>("button.checkdrop-address-assist-option"),
    );
    let active = -1;
    control.setAttribute("role", "combobox");
    control.setAttribute("aria-autocomplete", "list");
    control.setAttribute("aria-expanded", "true");
    control.setAttribute("aria-controls", panel.id);
    control.removeAttribute("aria-activedescendant");
    options.forEach((option, index) => {
      option.id = `${panel.id}-${index}`;
      option.tabIndex = -1;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.addEventListener("mousedown", (event) => event.preventDefault());
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        clearAssistPrompt(control);
        onDismiss?.();
      } else if (options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        event.stopPropagation();
        active =
          event.key === "ArrowDown"
            ? (active + 1) % options.length
            : active <= 0
              ? options.length - 1
              : active - 1;
        options.forEach((option, index) => {
          option.setAttribute("aria-selected", String(index === active));
        });
        const option = options[active];
        if (option) {
          control.setAttribute("aria-activedescendant", option.id);
          option.scrollIntoView({ block: "nearest" });
        }
      } else if (event.key === "Enter" && active >= 0) {
        event.preventDefault();
        event.stopPropagation();
        options[active]?.click();
        control.focus();
      }
    };
    const blur = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !panel.contains(event.relatedTarget)) {
        clearAssistPrompt(control);
        onDismiss?.();
      }
    };
    control.addEventListener("keydown", keydown);
    control.addEventListener("blur", blur);
    autocompleteCleanup.set(control, () => {
      control.removeEventListener("keydown", keydown);
      control.removeEventListener("blur", blur);
      for (const [name, value] of previous) {
        if (value === null) control.removeAttribute(name);
        else control.setAttribute(name, value);
      }
    });
  }

  function clearAssistPrompt(control: ValueControl) {
    autocompleteCleanup.get(control)?.();
    autocompleteCleanup.delete(control);
    const prompt = assistPrompts.get(control);
    prompt?.remove();
    assistPrompts.delete(control);
  }

  function clearAllAssistPrompts() {
    for (const control of assistPrompts.keys()) clearAssistPrompt(control);
  }

  function setNativeControlValue(control: ValueControl, value: string) {
    if (!setControlValueSilently(control, value)) return;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setControlValueSilently(control: ValueControl, value: string) {
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : control instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return false;
    setter.call(control, value);
    return true;
  }

  function installAssistPromptStyles() {
    if (document.getElementById("checkdrop-field-assist-style")) return;
    const style = document.createElement("style");
    style.id = "checkdrop-field-assist-style";
    style.textContent = [
      ".checkdrop-field-assist{align-items:center;background:#f8fafc;border:1px solid #dbe3ee;border-radius:6px;box-sizing:border-box;color:#334155;display:flex;flex-wrap:nowrap;font:500 13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;gap:6px;margin:6px 0 0;max-width:100%;padding:5px 7px;width:100%}",
      ".checkdrop-field-assist-copy{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".checkdrop-field-assist-actions{display:inline-flex;flex:0 0 auto;gap:5px;white-space:nowrap}",
      ".checkdrop-field-assist-icon{align-items:center;background:#e7f0ff;border-radius:50%;color:#1d4ed8;display:inline-flex;flex:0 0 18px;font:bold 12px/1 system-ui;height:18px;justify-content:center;width:18px}",
      ".checkdrop-field-assist strong{color:#172033;font-weight:750}",
      ".checkdrop-field-assist button{background:#2563eb;border:1px solid #2563eb;border-radius:5px;color:#fff;cursor:pointer;flex:0 0 auto;font:inherit;font-weight:700;line-height:1.2;margin:0;padding:4px 7px;white-space:nowrap}",
      ".checkdrop-field-assist button:focus-visible,.checkdrop-address-assist-option:focus-visible{outline:2px solid #2563eb;outline-offset:2px}",
      ".checkdrop-field-assist .checkdrop-field-assist-keep,.checkdrop-field-assist .checkdrop-field-assist-undo{background:#fff;border-color:#cbd5e1;color:#475569}",
      ".checkdrop-field-assist-applied{background:#f3faf6;border-color:#bfe1cc;color:#25623d}",
      ".checkdrop-field-assist-applied .checkdrop-field-assist-icon{background:#dff3e7;color:#18713c}",
      ".checkdrop-field-assist-warning{background:#fff7f6;border-color:#f1c5c1;color:#9f2d20;font-weight:650;width:fit-content}",
      ".checkdrop-field-assist-warning .checkdrop-field-assist-copy{overflow:visible;text-overflow:clip;white-space:normal}",
      ".checkdrop-field-assist-warning .checkdrop-field-assist-icon{background:#fce8e6;color:#b42318}",
      ".checkdrop-name-ok{align-items:center;color:#18713c;display:inline-flex;font:bold 16px/1 system-ui;height:20px;justify-content:center;margin:4px 0 0 6px;vertical-align:middle;width:20px}",
      ".checkdrop-address-assist{background:#fff;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box;color:#172033;font:500 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:6px 0 0;max-height:210px;max-width:100%;overflow:auto;width:100%}",
      ".checkdrop-address-assist-title{color:#475569;display:block;font-size:12px;font-weight:700;padding:6px 8px}",
      ".checkdrop-address-assist-warning{background:#fff7f6;color:#9f2d20;white-space:normal}",
      ".checkdrop-address-assist-list{display:block}",
      ".checkdrop-address-assist-option{background:#fff;border:0;border-top:1px solid #e2e8f0;color:#172033;cursor:pointer;display:block;font:inherit;overflow:hidden;padding:7px 8px;text-align:left;text-overflow:ellipsis;white-space:nowrap;width:100%}",
      ".checkdrop-address-assist-option[aria-selected='true'],.checkdrop-address-assist-option:hover{background:#f1f5f9}",
    ].join("");
    document.head.append(style);
  }

  function validationRequest(
    field: ConfiguredField,
    fields: readonly ConfiguredField[],
    value: string,
  ): { path: string; body: Record<string, unknown> } | null {
    if (["full_name", "first_name", "last_name"].includes(field.canonical_field)) {
      if (allowsCompanyDeliveryRecipient(field, fields)) return null;
      if (field.canonical_field !== "full_name" && !splitNameReady(field, fields)) return null;
      const fullName =
        field.canonical_field === "full_name"
          ? value
          : [
              fieldValue(fields, "first_name", field.context),
              fieldValue(fields, "last_name", field.context),
            ]
              .filter(Boolean)
              .join(" ");
      return {
        path: "/v1/names/validate",
        body: {
          full_name: fullName,
          // An explicitly required personal field remains a person even for a company buyer.
          customer_type: field.require_complete_name
            ? "private"
            : (customerType(fields) ?? "private"),
          context: field.context === "shipping" ? "shipping" : "billing",
          policy: "assist",
        },
      };
    }
    if (field.canonical_field === "email") {
      return { path: "/v1/emails/validate", body: { email: value, policy: "assist" } };
    }
    if (field.canonical_field === "phone") {
      if (!isCzechCountry(fieldLookupValues(fields, "country", field.context))) return null;
      return { path: "/v1/phones/validate", body: { phone: value, country: "CZ" } };
    }
    if (field.canonical_field === "street_line") {
      if (!isCzechCountry(fieldLookupValues(fields, "country", field.context))) return null;
      const city = fieldValue(fields, "city", field.context);
      const postalCode = fieldValue(fields, "postal_code", field.context);
      if (field.validation_mode === "suggest") {
        if (addressComponentsEnabled) {
          const components = {
            street_line: value.trim().slice(0, 200),
            city: city.trim().slice(0, 80),
            postal_code: postalCode.trim().slice(0, 10),
          };
          const query = [components.street_line, components.city, components.postal_code]
            .filter(Boolean)
            .join(" ")
            .slice(0, 256);
          return query.length >= 3
            ? {
                path: "/v1/addresses/autocomplete",
                body: { query, country: "CZ", limit: 5, components },
              }
            : null;
        }
        const query = [value.trim(), city, postalCode].filter(Boolean).join(" ").slice(0, 256);
        return query.length >= 3
          ? {
              path: "/v1/addresses/autocomplete",
              body: { query, country: "CZ", limit: 5 },
            }
          : null;
      }
      const combinedName = splitFullName(conditionedFieldValue(fields, "full_name", field.context));
      const firstName =
        conditionedFieldValue(fields, "first_name", field.context) || combinedName.firstName;
      const lastName =
        conditionedFieldValue(fields, "last_name", field.context) || combinedName.lastName;
      const cityField = findField(fields, "city", field.context);
      const postalCodeField = findField(fields, "postal_code", field.context);
      if ((cityField && !city) || (postalCodeField && !postalCode)) return null;
      return {
        path: "/v1/addresses/validate",
        body: {
          first_name: firstName,
          last_name: lastName,
          address: value,
          ...(city ? { city } : {}),
          ...(postalCode ? { postal_code: postalCode } : {}),
          country: "CZ",
        },
      };
    }
    if (field.canonical_field === "company_id") {
      const digits = value.replace(/\D/g, "");
      if (field.validation_trigger === "input" && digits.length >= 3 && digits.length < 8) {
        return {
          path: "/v1/companies/autocomplete",
          body: { query: digits, country: "CZ", limit: 5 },
        };
      }
      return {
        path: "/v1/company-ids/validate",
        body: { company_id: value, country: "CZ" },
      };
    }
    if (field.canonical_field === "company_name") {
      const query = value.trim();
      return query.length >= 3
        ? {
            path: "/v1/companies/autocomplete",
            body: { query, country: "CZ", limit: 5 },
          }
        : null;
    }
    return null;
  }

  function fieldValue(fields: readonly ConfiguredField[], canonicalField: string, context: string) {
    const field = findField(fields, canonicalField, context);
    return field ? (firstControl(field.selector, field.root_selector)?.value ?? "").trim() : "";
  }

  function conditionedFieldValue(
    fields: readonly ConfiguredField[],
    canonicalField: string,
    context: string,
  ) {
    const candidates = fields.filter((field) => field.canonical_field === canonicalField);
    const exact = candidates.filter((field) => field.context === context);
    const field =
      exact.find((candidate) => conditionMatches(candidate.condition_key, fields)) ??
      candidates.find((candidate) => conditionMatches(candidate.condition_key, fields)) ??
      exact[0] ??
      candidates[0];
    return field ? (firstControl(field.selector, field.root_selector)?.value ?? "").trim() : "";
  }

  function fieldLookupValues(
    fields: readonly ConfiguredField[],
    canonicalField: string,
    context: string,
  ) {
    const field = findField(fields, canonicalField, context);
    const control = field ? firstControl(field.selector, field.root_selector) : null;
    return control ? controlLookupValues(control) : [];
  }

  function findField(fields: readonly ConfiguredField[], canonicalField: string, context: string) {
    return (
      fields.find(
        (candidate) =>
          candidate.canonical_field === canonicalField && candidate.context === context,
      ) ?? fields.find((candidate) => candidate.canonical_field === canonicalField)
    );
  }

  function findExactField(
    fields: readonly ConfiguredField[],
    canonicalField: string,
    context: string,
  ) {
    return fields.find(
      (candidate) => candidate.canonical_field === canonicalField && candidate.context === context,
    );
  }

  function customerType(fields: readonly ConfiguredField[]): "private" | "company" | null {
    const values = fieldLookupValues(fields, "customer_type", "shared").map(normalizeLookup);
    if (
      values.some((value) =>
        /(^|\s)(company|business|firm|firma|na firmu|pravnicka osoba)(\s|$)/.test(value),
      )
    ) {
      return "company";
    }
    if (
      values.some((value) =>
        /(^|\s)(private|person|consumer|soukrom|soukrome|fyzicka osoba)(\s|$)/.test(value),
      )
    ) {
      return "private";
    }
    return null;
  }

  function allowsCompanyDeliveryRecipient(
    field: ConfiguredField,
    fields: readonly ConfiguredField[],
  ): boolean {
    return (
      field.canonical_field === "full_name" &&
      field.context === "shipping" &&
      customerType(fields) === "company"
    );
  }

  function conditionMatches(condition: string | null, fields: readonly ConfiguredField[]): boolean {
    if (!condition) return true;
    if (condition.includes("&")) {
      return condition
        .split("&")
        .filter(Boolean)
        .every((part) => conditionMatches(part, fields));
    }
    const type = customerType(fields);
    if (condition === "customer_type=private") return type === "private";
    if (condition === "customer_type=company") return type === "company";
    if (condition === "profile_details_enabled=true") {
      return booleanFieldEnabled(fields, "profile_details_enabled");
    }
    if (condition === "alternate_shipping_enabled=true") {
      return booleanFieldEnabled(fields, "alternate_shipping_enabled");
    }
    return false;
  }

  function clearInactiveFields(fields: readonly ConfiguredField[]) {
    for (const field of fields) {
      if (conditionMatches(field.condition_key, fields)) continue;
      const control = firstControl(field.selector, field.root_selector);
      if (control) clearAssistPrompt(control);
      const key = `${field.form_id}:${field.context}:${field.canonical_field}`;
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
      active.get(key)?.abort();
      active.delete(key);
      completedRequests.delete(key);
    }
  }

  function booleanFieldEnabled(fields: readonly ConfiguredField[], canonicalField: string) {
    const field = fields.find((candidate) => candidate.canonical_field === canonicalField);
    const control = field ? firstControl(field.selector, field.root_selector) : null;
    if (!control) return false;
    if (typeof control.checked === "boolean") return control.checked;
    return controlLookupValues(control)
      .map(normalizeLookup)
      .some((value) => ["1", "true", "yes", "ano", "on"].includes(value));
  }

  function isCzechCountry(values: readonly string[]) {
    return values.some((value) =>
      ["cz", "cze", "cesko", "ceska republika", "czech republic", "czechia"].includes(
        normalizeLookup(value),
      ),
    );
  }

  function normalizeLookup(value: string) {
    return value
      .trim()
      .toLocaleLowerCase("cs")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .replace(/\s+/g, " ");
  }

  function splitFullName(value: string) {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
  }

  function splitNameReady(field: ConfiguredField, fields: readonly ConfiguredField[]) {
    const counterpartName = field.canonical_field === "first_name" ? "last_name" : "first_name";
    const counterpart = findField(fields, counterpartName, field.context);
    if (!counterpart) return true;
    const counterpartControl = firstControl(counterpart.selector, counterpart.root_selector);
    return (
      Boolean(counterpartControl?.value.trim()) ||
      Boolean(counterpartControl && touchedNameControls.has(counterpartControl))
    );
  }

  function clearRelatedNamePrompts(field: ConfiguredField, fields: readonly ConfiguredField[]) {
    for (const candidate of fields) {
      if (
        candidate.form_id !== field.form_id ||
        candidate.context !== field.context ||
        !["full_name", "first_name", "last_name"].includes(candidate.canonical_field)
      ) {
        continue;
      }
      const candidateControl = firstControl(candidate.selector, candidate.root_selector);
      if (candidateControl) clearAssistPrompt(candidateControl);
    }
  }

  function loadCheckoutSessionId(siteKey: string) {
    const storageKey = `checkdrop:checkout-session:${siteKey}`;
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (stored && isUuidV4(stored)) return stored;
      const created = createCheckoutSessionId();
      window.sessionStorage.setItem(storageKey, created);
      return created;
    } catch {
      return createCheckoutSessionId();
    }
  }

  function createCheckoutSessionId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  function isUuidV4(value: string) {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
  }

  type ValueControl = Element & {
    value: string;
    type?: string;
    checked?: boolean;
    labels?: NodeListOf<HTMLLabelElement> | null;
    selectedOptions?: HTMLCollectionOf<HTMLOptionElement>;
  };

  function asValueControl(value: EventTarget | null): ValueControl | null {
    return value instanceof Element && "value" in value ? (value as ValueControl) : null;
  }

  function firstControl(selector: string, rootSelector = "body"): ValueControl | null {
    try {
      const root = document.querySelector(rootSelector);
      if (!root) return null;
      const controls = [
        ...(safeMatches(root, selector) ? [root] : []),
        ...Array.from(root.querySelectorAll(selector)),
      ]
        .map((control) => asValueControl(control))
        .filter((control): control is ValueControl => control !== null);
      return (
        controls.find((control) => control.type !== "radio" || control.checked) ??
        controls[0] ??
        null
      );
    } catch {
      return null;
    }
  }

  function controlLookupValues(control: ValueControl) {
    const values = [control.value];
    const selected = control.selectedOptions?.[0]?.textContent;
    if (selected) values.push(selected);
    for (const label of Array.from(control.labels ?? [])) {
      if (label.textContent) values.push(label.textContent);
    }
    return values.map((value) => value.trim()).filter(Boolean);
  }

  function safeMatches(control: Element, selector: string) {
    try {
      return control.matches(selector);
    } catch {
      return false;
    }
  }

  function safeMatchesWithin(control: ValueControl, selector: string, rootSelector: string) {
    return safeMatches(control, selector) && elementInsideRoot(control, rootSelector);
  }

  function elementInsideRoot(element: Element, rootSelector: string) {
    try {
      const root = document.querySelector(rootSelector);
      return Boolean(root && (root === element || root.contains(element)));
    } catch {
      return false;
    }
  }

  function disposeCurrentObservation() {
    disposeObservation?.();
    disposeObservation = null;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const controller of active.values()) controller.abort();
    active.clear();
    clearAllAssistPrompts();
  }

  function insertAssistElement(control: ValueControl, element: HTMLElement) {
    // A suggestion inside an implicit label changes the field's accessible name as options change.
    const anchor = control.closest("label") ?? control;
    anchor.insertAdjacentElement("afterend", element);
  }

  function pagePath() {
    const path = window.location.pathname || "/";
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  }
}

// Build-time data only: the reviewed typo list, text catalogues and three self-contained functions,
// no customer data.
export const CHECKDROP_EMBED_SCRIPT = `"use strict";\n(${checkdropEmbedRuntime.toString()})(${personNameRequirement.toString()}, ${parseEmailForSuggestion.toString()}, ${JSON.stringify(defaultCountryPack.emailRules.instantCorrections ?? {})}, ${JSON.stringify(defaultCountryPack.embedTexts)}, ${defaultCountryPack.address.looksForeign.toString()}, ${JSON.stringify(defaultCountryPack.embedTranslations ?? {})});\n`;
