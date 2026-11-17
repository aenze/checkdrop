import {
  ArrowLeftIcon as ArrowLeft,
  AtIcon as At,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  EnvelopeSimpleIcon as EnvelopeSimple,
  MapPinIcon as MapPin,
  PhoneIcon as Phone,
  ShieldCheckIcon as ShieldCheck,
  WarningCircleIcon as WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { localeHeader, t } from "../i18n";
import AdminNavigation from "./AdminNavigation";

type ValidationStatus = "valid" | "correctable" | "risky" | "invalid" | "unknown";

interface ValidationResult {
  readonly status: ValidationStatus;
  readonly normalized: string | null;
  readonly suggestion: string | null;
  readonly issues: readonly { readonly code: string }[];
  readonly evidence: readonly { readonly source: string; readonly state: string }[];
}

interface AddressAutocompleteSuggestion {
  readonly id: string;
  readonly label: string;
  readonly street_line: string;
  readonly city: string;
  readonly city_part: string | null;
  readonly postal_code: string;
}

interface AddressAutocompleteResult {
  readonly status: "matched" | "no_match" | "unavailable";
  readonly suggestions: readonly AddressAutocompleteSuggestion[];
}

type RequestState<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: T; readonly latencyMs: number | null }
  | { readonly kind: "error"; readonly message: string };

const emailStatusLabels: Record<ValidationResult["status"], string> = {
  valid: t("E-mail je v pořádku", "The email is fine"),
  correctable: t("Nalezen návrh opravy", "A fix is suggested"),
  risky: t("E-mail vyžaduje pozornost", "The email needs attention"),
  invalid: t("E-mail není platný", "The email is not valid"),
  unknown: t("Kontrolu se nepodařilo dokončit", "The check could not be completed"),
};

export default function ValidationPlayground() {
  const [email, setEmail] = useState("");
  const [emailState, setEmailState] = useState<RequestState<ValidationResult>>({ kind: "idle" });
  const [address, setAddress] = useState("");
  const [addressState, setAddressState] = useState<RequestState<AddressAutocompleteResult>>({
    kind: "idle",
  });
  const [selectedAddress, setSelectedAddress] = useState<AddressAutocompleteSuggestion | null>(
    null,
  );
  const [activeAddress, setActiveAddress] = useState(-1);
  const addressInput = useRef<HTMLInputElement>(null);
  const emailRequest = useRef(0);
  const addressRequest = useRef(0);

  useEffect(() => {
    const value = email.trim();
    if (value.length < 3 || !value.includes("@")) {
      setEmailState({ kind: "idle" });
      return;
    }
    const requestId = ++emailRequest.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setEmailState({ kind: "loading" });
      requestValidation<ValidationResult>(
        "/v1/emails/validate",
        { email: value, policy: "assist" },
        `playground-email-${requestId}-${Date.now()}`,
        controller.signal,
      )
        .then((response) => {
          if (controller.signal.aborted || requestId !== emailRequest.current) return;
          setEmailState({
            kind: "ready",
            data: response.result,
            latencyMs: response.timing.serverMs,
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestId !== emailRequest.current) return;
          setEmailState({ kind: "error", message: requestError(error) });
        });
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [email]);

  useEffect(() => {
    const value = address.trim();
    if (selectedAddress?.label === value) return;
    setSelectedAddress(null);
    if (value.length < 3) {
      setAddressState({ kind: "idle" });
      return;
    }
    const requestId = ++addressRequest.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setAddressState({ kind: "loading" });
      requestValidation<AddressAutocompleteResult>(
        "/v1/addresses/autocomplete",
        { query: value, country: "CZ", limit: 6 },
        `playground-address-${requestId}-${Date.now()}`,
        controller.signal,
      )
        .then((response) => {
          if (controller.signal.aborted || requestId !== addressRequest.current) return;
          setAddressState({
            kind: "ready",
            data: response.result,
            latencyMs: response.timing.serverMs,
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestId !== addressRequest.current) return;
          setAddressState({ kind: "error", message: requestError(error) });
        });
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address, selectedAddress]);

  const chooseAddress = (suggestion: AddressAutocompleteSuggestion) => {
    addressRequest.current += 1;
    setActiveAddress(-1);
    addressInput.current?.focus();
    setSelectedAddress(suggestion);
    setAddress(suggestion.label);
    setAddressState({ kind: "idle" });
  };

  return (
    <div className="validation-playground-shell">
      <header className="playground-topbar">
        <a
          className="playground-brand"
          href="/"
          aria-label={t("Checkdrop – domů", "Checkdrop – home")}
        >
          <span className="playground-brand-mark" aria-hidden="true">
            <CheckCircle size={24} weight="duotone" />
          </span>
          <strong>Checkdrop</strong>
        </a>
        <span className="playground-mode">
          <ShieldCheck size={17} weight="duotone" aria-hidden="true" />
          {t("Testovací režim", "Test mode")}
        </span>
      </header>

      <AdminNavigation active="playground" />
      <main className="playground-main">
        <a className="playground-back" href="/dashboard">
          <ArrowLeft size={16} aria-hidden="true" />
          {t("Zpět na přehled", "Back to overview")}
        </a>

        <div className="playground-heading">
          <div>
            <span className="playground-eyebrow">{t("TEST KONTROL", "CHECK TEST")}</span>
            <h1>{t("Ověření údajů", "Data checks")}</h1>
            <p>
              {t(
                "Vyzkoušejte e-mail, telefon nebo českou adresu.",
                "Try an email, a phone number or a Czech address.",
              )}
            </p>
          </div>
          <div className="playground-source">
            <span className="playground-source-label">{t("Datové zdroje", "Data sources")}</span>
            <strong>RÚIAN · DNS/MX</strong>
          </div>
        </div>

        <div className="playground-grid">
          <section className="playground-card" aria-labelledby="email-title">
            <div className="playground-card-heading">
              <span className="playground-card-icon email">
                <EnvelopeSimple size={22} weight="duotone" aria-hidden="true" />
              </span>
              <div>
                <span className="playground-card-kicker">
                  {t("Syntaxe · doména · DNS/MX", "Syntax · domain · DNS/MX")}
                </span>
                <h2 id="email-title">{t("Kontrola e-mailu", "Email check")}</h2>
              </div>
            </div>

            <label className="playground-field">
              <span>{t("E-mailová adresa", "Email address")}</span>
              <span className="playground-input-wrap">
                <At size={19} aria-hidden="true" />
                <input
                  type="email"
                  autoComplete="off"
                  value={email}
                  placeholder="jan.novak@gmil.com"
                  onChange={(event) => setEmail(event.currentTarget.value)}
                />
                {emailState.kind === "loading" ? <span className="playground-spinner" /> : null}
              </span>
            </label>

            <EmailResult state={emailState} onApplySuggestion={setEmail} />
          </section>
          <PhoneCheck />
          <section className="playground-card" aria-labelledby="address-title">
            <div className="playground-card-heading">
              <span className="playground-card-icon address">
                <MapPin size={22} weight="duotone" aria-hidden="true" />
              </span>
              <div>
                <span className="playground-card-kicker">
                  {t("Lokální databáze RÚIAN", "Local RÚIAN database")}
                </span>
                <h2 id="address-title">
                  {t("Našeptávání české adresy", "Czech address autocomplete")}
                </h2>
              </div>
            </div>

            <label className="playground-field">
              <span>
                {t("Začněte psát ulici, číslo a obec", "Start typing street, number and town")}
              </span>
              <span className="playground-input-wrap">
                <MapPin size={19} aria-hidden="true" />
                <input
                  type="text"
                  ref={addressInput}
                  role="combobox"
                  aria-activedescendant={
                    activeAddress >= 0 && addressState.kind === "ready"
                      ? `address-option-${activeAddress}`
                      : undefined
                  }
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    const suggestions =
                      addressState.kind === "ready" ? addressState.data.suggestions : [];
                    if (event.key === "Escape" || event.key === "Tab") {
                      if (event.key === "Escape" && suggestions.length) event.preventDefault();
                      addressRequest.current += 1;
                      setActiveAddress(-1);
                      setAddressState({ kind: "idle" });
                    } else if (
                      suggestions.length &&
                      (event.key === "ArrowDown" || event.key === "ArrowUp")
                    ) {
                      event.preventDefault();
                      setActiveAddress((current) =>
                        event.key === "ArrowDown"
                          ? (current + 1) % suggestions.length
                          : current <= 0
                            ? suggestions.length - 1
                            : current - 1,
                      );
                    } else if (
                      event.key === "Enter" &&
                      activeAddress >= 0 &&
                      suggestions[activeAddress]
                    ) {
                      event.preventDefault();
                      chooseAddress(suggestions[activeAddress]);
                    }
                  }}
                  aria-autocomplete="list"
                  aria-controls="address-suggestions"
                  aria-expanded={
                    addressState.kind === "ready" && addressState.data.suggestions.length > 0
                  }
                  autoComplete="off"
                  value={address}
                  placeholder="Dlouhá 1 Praha"
                  onChange={(event) => {
                    setActiveAddress(-1);
                    setAddressState({ kind: "idle" });
                    setAddress(event.currentTarget.value);
                  }}
                />
                {addressState.kind === "loading" ? <span className="playground-spinner" /> : null}
              </span>
            </label>

            {selectedAddress ? (
              <SelectedAddress suggestion={selectedAddress} />
            ) : (
              <AddressResult
                state={addressState}
                activeIndex={activeAddress}
                onChoose={chooseAddress}
              />
            )}
          </section>
        </div>

        <footer className="playground-footer">
          <ShieldCheck size={18} weight="duotone" aria-hidden="true" />
          <span>
            {t(
              "API klíč zůstává na serverové proxy. Výsledky na této stránce se samy neaplikují.",
              "The API key stays on the server proxy. Results on this page are never applied automatically.",
            )}
          </span>
        </footer>
      </main>
    </div>
  );
}

function AddressResult({
  activeIndex,
  state,
  onChoose,
}: {
  readonly activeIndex: number;
  readonly state: RequestState<AddressAutocompleteResult>;
  readonly onChoose: (suggestion: AddressAutocompleteSuggestion) => void;
}) {
  if (state.kind === "idle") {
    return (
      <EmptyResult
        text={t(
          "Návrhy se zobrazí po zadání alespoň tří znaků.",
          "Suggestions appear after at least three characters.",
        )}
      />
    );
  }
  if (state.kind === "loading") {
    return (
      <EmptyResult
        text={t("Hledám v české databázi adres…", "Searching the Czech address database…")}
      />
    );
  }
  if (state.kind === "error") {
    return <ErrorResult text={state.message} />;
  }
  if (state.data.status === "unavailable") {
    return (
      <ErrorResult
        text={t(
          "RÚIAN je dočasně nedostupný. Formulář může pokračovat bez návrhu.",
          "RÚIAN is temporarily unavailable. The form can continue without a suggestion.",
        )}
      />
    );
  }
  if (state.data.suggestions.length === 0) {
    return (
      <EmptyResult
        text={t(
          "Pro zadaný text nebyla nalezena česká adresa.",
          "No Czech address was found for this text.",
        )}
      />
    );
  }
  return (
    <div className="address-suggestion-panel">
      <div className="result-meta">
        <span>
          {t(
            `${state.data.suggestions.length} návrhů`,
            `${state.data.suggestions.length} ${state.data.suggestions.length === 1 ? "suggestion" : "suggestions"}`,
          )}
        </span>
        <Latency value={state.latencyMs} />
      </div>
      <div id="address-suggestions" role="listbox" className="address-suggestion-list">
        {state.data.suggestions.map((suggestion, index) => (
          <button
            type="button"
            role="option"
            id={`address-option-${index}`}
            aria-selected={activeIndex === index}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            key={suggestion.id}
            onClick={() => onChoose(suggestion)}
          >
            <MapPin size={18} weight="duotone" aria-hidden="true" />
            <span className="address-suggestion-copy">
              <strong>{suggestion.street_line || suggestion.label}</strong>
              <small>{addressLocality(suggestion)}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectedAddress({ suggestion }: { readonly suggestion: AddressAutocompleteSuggestion }) {
  return (
    <div className="selected-address" role="status">
      <CheckCircle size={20} weight="fill" aria-hidden="true" />
      <div>
        <span className="selected-address-label">
          {t("Vybraná adresa z RÚIAN", "Selected RÚIAN address")}
        </span>
        <strong>{suggestion.label}</strong>
        <small className="selected-address-id">
          {t("ID adresního místa:", "Address point ID:")} {suggestion.id}
        </small>
      </div>
    </div>
  );
}

function EmailResult({
  state,
  onApplySuggestion,
}: {
  readonly state: RequestState<ValidationResult>;
  readonly onApplySuggestion: (suggestion: string) => void;
}) {
  if (state.kind === "idle") {
    return (
      <EmptyResult
        text={t(
          "Kontrola se spustí po zadání celé domény.",
          "The check starts once the full domain is entered.",
        )}
      />
    );
  }
  if (state.kind === "loading") {
    return (
      <EmptyResult
        text={t(
          "Kontroluji formát a poštovní servery domény…",
          "Checking the format and the domain mail servers…",
        )}
      />
    );
  }
  if (state.kind === "error") {
    return <ErrorResult text={state.message} />;
  }

  const tone = state.data.status === "valid" ? "valid" : state.data.status;
  const proposal = state.data.suggestion ?? state.data.normalized;
  return (
    <div className={`email-result ${tone}`} role="status">
      <div className="email-result-title">
        {state.data.status === "valid" ? (
          <CheckCircle size={22} weight="fill" aria-hidden="true" />
        ) : (
          <WarningCircle size={22} weight="fill" aria-hidden="true" />
        )}
        <div>
          <strong>{emailStatusLabels[state.data.status]}</strong>
          <span className="email-result-message">
            {state.data.issues[0]
              ? emailIssueMessage(state.data.issues[0].code)
              : t("Formát i doména prošly kontrolou.", "The format and domain passed the check.")}
          </span>
        </div>
        <Latency value={state.latencyMs} />
      </div>
      {proposal ? (
        <div className="email-proposal">
          <span className="email-proposal-label">
            {state.data.suggestion
              ? t("Měli jste na mysli?", "Did you mean?")
              : t("Normalizovaný tvar", "Normalized form")}
          </span>
          <div className="email-proposal-value">
            <strong>{proposal}</strong>
            {state.data.suggestion ? (
              <button type="button" onClick={() => onApplySuggestion(state.data.suggestion ?? "")}>
                {t("Použít opravu", "Apply fix")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="email-evidence">
        {state.data.evidence.map((evidence) => (
          <span className="email-evidence-item" key={`${evidence.source}-${evidence.state}`}>
            {evidenceLabel(evidence.source)} · {evidenceStateLabel(evidence.state)}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyResult({ text }: { readonly text: string }) {
  return (
    <div className="playground-empty">
      <Clock size={20} weight="duotone" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function ErrorResult({ text }: { readonly text: string }) {
  return (
    <div className="playground-error" role="status">
      <WarningCircle size={20} weight="duotone" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function Latency({ value }: { readonly value: number | null }) {
  return value === null ? null : <small className="result-latency">{Math.round(value)} ms</small>;
}

function addressLocality(suggestion: AddressAutocompleteSuggestion) {
  const postalCode = `${suggestion.postal_code.slice(0, 3)} ${suggestion.postal_code.slice(3)}`;
  const locality =
    suggestion.city_part && suggestion.city_part !== suggestion.city
      ? `${suggestion.city_part}, ${suggestion.city}`
      : suggestion.city;
  return `${postalCode} ${locality}`;
}

function evidenceLabel(source: string) {
  if (source === "syntax") return t("Formát", "Format");
  if (source === "dns") return "DNS/MX";
  if (source === "domain_metadata") return t("Typ domény", "Domain type");
  if (source === "local_part") return t("Typ schránky", "Mailbox type");
  return source;
}

function evidenceStateLabel(state: string) {
  if (state === "confirmed") return t("ověřeno", "confirmed");
  if (state === "absent") return t("nenalezeno", "not found");
  if (state === "unavailable") return t("nedostupné", "unavailable");
  return state;
}

function emailIssueMessage(code: string) {
  if (code === "email.syntax_invalid")
    return t("E-mail nemá platný formát.", "The email format is not valid.");
  if (code === "email.domain_invalid")
    return t("Doména e-mailu nemá platný formát.", "The email domain format is not valid.");
  if (code === "email.domain_typo")
    return t("Doména pravděpodobně obsahuje překlep.", "The domain probably contains a typo.");
  if (code === "email.domain_no_dns")
    return t("Doména nebyla nalezena v DNS.", "The domain was not found in DNS.");
  if (code === "email.domain_no_mx")
    return t("Doména nemá vlastní poštovní server MX.", "The domain has no MX mail server.");
  if (code === "email.domain_disposable")
    return t("Jde o dočasnou e-mailovou službu.", "This is a disposable email service.");
  if (code === "email.local_role")
    return t(
      "Jde pravděpodobně o obecnou firemní schránku.",
      "This is probably a generic company mailbox.",
    );
  return t("E-mail vyžaduje kontrolu.", "The email needs a check.");
}

function requestError(error: unknown) {
  return error instanceof Error
    ? error.message
    : t("Kontrolu se nepodařilo dokončit.", "The check could not be completed.");
}

async function requestValidation<T>(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<{ readonly result: T; readonly timing: { readonly serverMs: number | null } }> {
  const response = await fetch(`/checkdrop${path}`, {
    method: "POST",
    headers: {
      ...localeHeader,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey.slice(0, 128),
    },
    body: JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(2_500)]),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new Error(
      typeof problem?.detail === "string"
        ? problem.detail
        : t("Kontrolu se nepodařilo dokončit.", "The check could not be completed."),
    );
  }
  return {
    result: (await response.json()) as T,
    timing: { serverMs: serverTiming(response.headers.get("Server-Timing")) },
  };
}

function serverTiming(value: string | null): number | null {
  const match = value?.match(/(?:^|,)\s*checkdrop;dur=([0-9.]+)/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function PhoneCheck() {
  const [value, setValue] = useState("");
  const [state, setState] = useState<RequestState<ValidationResult>>({ kind: "idle" });
  useEffect(() => {
    const phone = value.trim();
    setState({ kind: "idle" });
    if (!phone) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ kind: "loading" });
      void requestValidation<ValidationResult>(
        "/v1/phones/validate",
        { phone, country: "CZ" },
        crypto.randomUUID(),
        controller.signal,
      )
        .then(({ result, timing }) => {
          if (!controller.signal.aborted)
            setState({ kind: "ready", data: result, latencyMs: timing.serverMs });
        })
        .catch((error) => {
          if (!controller.signal.aborted) setState({ kind: "error", message: requestError(error) });
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);
  return (
    <section className="playground-card" aria-labelledby="phone-title">
      <div className="playground-card-heading">
        <span className="playground-card-icon">
          <Phone size={22} aria-hidden="true" />
        </span>
        <h2 id="phone-title">{t("Kontrola telefonu", "Phone check")}</h2>
      </div>
      <label className="playground-field">
        <span>{t("Telefonní číslo", "Phone number")}</span>
        <span className="playground-input-wrap">
          <Phone size={19} aria-hidden="true" />
          <input
            type="tel"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="777 123 456"
          />
        </span>
      </label>
      <div aria-live="polite">
        {state.kind === "idle" ? (
          <EmptyResult
            text={t(
              "Zadejte telefon včetně předvolby, nebo české číslo.",
              "Enter a phone number with its country code, or a Czech number.",
            )}
          />
        ) : null}
        {state.kind === "loading" ? (
          <EmptyResult text={t("Kontroluji telefon…", "Checking phone…")} />
        ) : null}
        {state.kind === "error" ? <ErrorResult text={state.message} /> : null}
        {state.kind === "ready" ? (
          <div className={`email-result ${state.data.status}`}>
            <strong>
              {
                {
                  valid: t("Telefon je v pořádku", "The phone number is fine"),
                  correctable: t("Upravený formát telefonu", "Adjusted phone format"),
                  risky: t("Telefon vyžaduje pozornost", "The phone number needs attention"),
                  invalid: t("Telefon není platný", "The phone number is not valid"),
                  unknown: t("Kontrolu se nepodařilo dokončit", "The check could not be completed"),
                }[state.data.status]
              }
            </strong>
            {state.data.normalized ? <p>{state.data.normalized}</p> : null}
            <small>
              {t(
                "Výsledek kontroly. Zadané číslo zůstává beze změny.",
                "Check result. The number you entered stays unchanged.",
              )}
            </small>
          </div>
        ) : null}
      </div>
    </section>
  );
}
