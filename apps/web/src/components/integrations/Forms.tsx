import { ArrowRightIcon as ArrowRight, PlusIcon as Plus } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import {
  clientIdentifier,
  type Environment,
  type IntegrationFormProfile,
  type MatchMode,
} from "./model";
export interface NewIntegrationInput {
  readonly name: string;
  readonly client_name: string;
  readonly environment: Environment;
  readonly form_url: string;
  readonly form_name: string;
}

export interface NewFormInput {
  readonly name: string;
  readonly form_url: string;
  readonly match_mode: MatchMode;
  readonly root_selector: string;
}

export function NewIntegrationForm({
  busy,
  onCancel,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (input: NewIntegrationInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [formName, setFormName] = useState("");
  const [url, setUrl] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({
      name: name.trim(),
      client_name: clientIdentifier(name, url),
      environment: "test",
      form_url: url,
      form_name: formName.trim(),
    });
  };
  return (
    <form className="new-integration" onSubmit={submit}>
      <div className="new-integration-copy">
        <span className="section-number">1</span>
        <div>
          <strong>
            {t("Přidejte web a jeho první formulář", "Add a website and its first form")}
          </strong>
          <p>
            {t(
              "Jeden instalační kód pak obslouží všechny další formuláře stejné domény.",
              "One installation code then serves every other form on the same domain.",
            )}
          </p>
        </div>
      </div>
      <label>
        <span>{t("Název webu", "Website name")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          maxLength={120}
          placeholder={t("Např. Můj e-shop", "E.g. My shop")}
        />
      </label>
      <label>
        <span>{t("Název prvního formuláře", "First form name")}</span>
        <input
          value={formName}
          onChange={(e) => setFormName(e.currentTarget.value)}
          required
          maxLength={120}
          placeholder={t("Např. Objednávka", "E.g. Checkout")}
        />
      </label>
      <label className="url-field">
        <span>{t("URL formuláře", "Form URL")}</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          required
          placeholder="https://www.example.cz/objednavka"
        />
      </label>
      <div className="new-integration-actions">
        <button type="button" className="quiet-button" onClick={onCancel}>
          {t("Zrušit", "Cancel")}
        </button>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? (
            t("Načítám formulář…", "Loading form…")
          ) : (
            <>
              {t("Najít pole", "Find fields")} <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>
    </form>
  );
}

export function FormSwitcher({
  forms,
  selectedId,
  busy,
  onChoose,
  onNew,
}: {
  readonly forms: readonly IntegrationFormProfile[];
  readonly selectedId: string | null;
  readonly busy: string | null;
  readonly onChoose: (form: IntegrationFormProfile) => void;
  readonly onNew: () => void;
}) {
  return (
    <section
      className={`form-switcher${forms.length === 1 ? " single-form" : ""}`}
      aria-labelledby="site-forms-title"
    >
      <header>
        <span>
          <strong id="site-forms-title">
            {t("Formuláře na tomto webu", "Forms on this website")}
          </strong>
          <small>
            {t(
              "Každá cesta má vlastní mapování. Instalační kód zůstává společný.",
              "Each path has its own mapping. The installation code stays shared.",
            )}
          </small>
        </span>
        <button className="secondary-button" type="button" onClick={onNew} disabled={busy !== null}>
          <Plus size={15} /> {t("Přidat formulář", "Add form")}
        </button>
      </header>
      <div className="form-switcher-list">
        {forms.map((form) => (
          <button
            key={form.id}
            type="button"
            className={form.id === selectedId ? "selected" : ""}
            onClick={() => onChoose(form)}
          >
            <span className={`form-state-dot ${form.state}`} />
            <span>
              <strong>{form.name}</strong>
              <small>
                {form.path_pattern} ·{" "}
                {t(
                  `${form.fields.length} polí`,
                  `${form.fields.length} ${form.fields.length === 1 ? "field" : "fields"}`,
                )}
              </small>
            </span>
            {form.is_default ? <em>{t("Výchozí", "Default")}</em> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

export function NewFormForm({
  origin,
  busy,
  onCancel,
  onSubmit,
}: {
  readonly origin: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (input: NewFormInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState(`${origin}/`);
  const [matchMode, setMatchMode] = useState<MatchMode>("exact");
  const [rootSelector, setRootSelector] = useState("body");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({
      name: name.trim(),
      form_url: url,
      match_mode: matchMode,
      root_selector: rootSelector.trim() || "body",
    });
  };
  return (
    <form className="new-form-profile" onSubmit={submit}>
      <div>
        <strong>{t("Další formulář stejného webu", "Another form on the same website")}</strong>
        <p>
          {t(
            "Checkdrop načte jen strukturu polí z uvedené stránky.",
            "Checkdrop reads only the field structure of the given page.",
          )}
        </p>
      </div>
      <label>
        <span>{t("Název formuláře", "Form name")}</span>
        <input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
          maxLength={120}
          placeholder={t("Např. Registrace", "E.g. Registration")}
        />
      </label>
      <label className="url-field">
        <span>{t("URL stránky", "Page URL")}</span>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          required
        />
      </label>
      <label>
        <span>{t("Platnost pravidla", "Rule applies to")}</span>
        <select
          value={matchMode}
          onChange={(event) => setMatchMode(event.currentTarget.value as MatchMode)}
        >
          <option value="exact">{t("Jen tato přesná cesta", "Only this exact path")}</option>
          <option value="prefix">
            {t("Tato cesta a její podstránky", "This path and its subpages")}
          </option>
        </select>
      </label>
      <label>
        <span>{t("Kořen formuláře", "Form root")}</span>
        <input
          value={rootSelector}
          onChange={(event) => setRootSelector(event.currentTarget.value)}
          required
          maxLength={512}
          placeholder={t(
            "#checkout-form nebo [role='dialog']",
            "#checkout-form or [role='dialog']",
          )}
        />
        <small>
          {t(
            "CSS selektor oddělí tento formulář od dalších na stejné stránce.",
            "The CSS selector separates this form from others on the same page.",
          )}
        </small>
      </label>
      <div className="new-integration-actions">
        <button type="button" className="quiet-button" onClick={onCancel}>
          {t("Zrušit", "Cancel")}
        </button>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? t("Přidávám…", "Adding…") : t("Přidat a najít pole", "Add and find fields")}
        </button>
      </div>
    </form>
  );
}

export function RootSelectorEditor({
  value: selector,
  savedValue,
  onChange: setSelector,
  busy,
  onSave,
}: {
  readonly value: string;
  readonly savedValue: string;
  readonly onChange: (value: string) => void;
  readonly busy: boolean;
  readonly onSave: (value: string) => Promise<void>;
}) {
  const changed = selector.trim() !== savedValue;
  return (
    <form
      className="root-selector-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (selector.trim()) void onSave(selector.trim());
      }}
    >
      <label>
        <span>{t("Kořen tohoto formuláře", "Root of this form")}</span>
        <input
          value={selector}
          disabled={busy}
          onChange={(event) => setSelector(event.currentTarget.value)}
          required
          maxLength={512}
          aria-label={t("Kořenový CSS selektor formuláře", "Form root CSS selector")}
        />
      </label>
      <button className="quiet-button" type="submit" disabled={!changed || busy}>
        {busy ? t("Ukládám…", "Saving…") : t("Uložit", "Save")}
      </button>
      <small>
        {t("Např.", "E.g.")} <code>#checkout</code>, <code>#registration</code> {t("nebo", "or")}{" "}
        <code>[role='dialog']</code>.
      </small>
    </form>
  );
}
