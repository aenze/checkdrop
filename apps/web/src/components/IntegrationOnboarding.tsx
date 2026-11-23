import {
  ArrowClockwiseIcon as ArrowClockwise,
  ArrowRightIcon as ArrowRight,
  CheckCircleIcon as CheckCircle,
  CheckSquareIcon as CheckSquare,
  LinkSimpleIcon as LinkSimple,
  PlusIcon as Plus,
  ShieldCheckIcon as ShieldCheck,
  WarningCircleIcon as WarningCircle,
  WrenchIcon as Wrench,
} from "@phosphor-icons/react";
import { t } from "../i18n";
import AdminNavigation from "./AdminNavigation";
import {
  FormSwitcher,
  NewFormForm,
  NewIntegrationForm,
  RootSelectorEditor,
} from "./integrations/Forms";
import { MappingRow } from "./integrations/MappingRow";
import { formCountLabel, type Integration, runtimeLabel, runtimeTone } from "./integrations/model";
import { ActivationSection, ConfigHistory, InstallScriptSection } from "./integrations/Setup";
import { useIntegrationEditor } from "./integrations/useIntegrationEditor";
import UnsavedChangesDialog from "./UnsavedChangesDialog";

export default function IntegrationOnboarding() {
  const {
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
    guardCount,
    assistanceDescription,
    totalMappedCount,
    receivedData,
    currentStep,
  } = useIntegrationEditor();

  return (
    <div className="integration-shell">
      {pendingTransition ? (
        <UnsavedChangesDialog
          busy={busy !== null}
          onStay={() => setPendingTransition(null)}
          onDiscard={() => {
            discardDraft();
            setPendingTransition(null);
            pendingTransition();
          }}
          onSave={() => {
            void (async () => {
              const action = pendingTransition;
              // Close the modal on failure so the inline error can be read and corrected.
              const saved = await saveDraft();
              setPendingTransition(null);
              if (saved) action();
            })();
          }}
        />
      ) : null}
      <IntegrationTopbar />
      <AdminNavigation active="integrations" />
      <main className="integration-main">
        <header className="integration-heading">
          <div>
            <span className="integration-eyebrow">
              {t("WEBY A FORMULÁŘE", "WEBSITES AND FORMS")}
            </span>
            <h1>{t("Napojení formulářů", "Form connections")}</h1>
            <p>
              {t(
                "Mapování, pravidla kontroly a stav jednotlivých formulářů.",
                "Mapping, check rules and the status of each form.",
              )}
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => transition(() => setCreating(true))}
          >
            <Plus size={17} weight="bold" /> {t("Přidat web", "Add website")}
          </button>
        </header>

        {!receivedData ? <OnboardingSteps current={Math.min(currentStep, 3)} /> : null}

        {error ? (
          <div className="integration-message error" role="alert">
            <WarningCircle size={19} weight="fill" /> <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              {t("Zavřít", "Close")}
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="integration-message success" role="status">
            <CheckCircle size={19} weight="fill" /> <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)}>
              {t("Zavřít", "Close")}
            </button>
          </div>
        ) : null}

        {creating ? (
          <NewIntegrationForm
            busy={busy === "create" || busy === "scan"}
            onCancel={() => setCreating(false)}
            onSubmit={create}
          />
        ) : null}

        <div className="integration-layout">
          <IntegrationList
            integrations={integrations}
            selectedId={selected?.id ?? null}
            loading={loading}
            onChoose={(integration) => transition(() => void choose(integration))}
            onNew={() => transition(() => setCreating(true))}
          />

          {selected ? (
            <section
              className="integration-detail"
              aria-label={t("Nastavení napojení", "Connection settings")}
            >
              <div className="integration-detail-head">
                <div>
                  <div className="integration-title-line">
                    <h2>{selected.name}</h2>
                    <span className={`state-pill ${runtimeTone(selected)}`}>
                      {runtimeLabel(selected)}
                    </span>
                  </div>
                  <a
                    href={selectedForm?.form_url ?? selected.form_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <LinkSimple size={14} /> {new URL(selected.form_url).origin}
                  </a>
                </div>
                <span className="site-form-count">{formCountLabel(selected.forms.length)}</span>
              </div>

              <FormSwitcher
                forms={selected.forms}
                selectedId={selectedForm?.id ?? null}
                busy={busy}
                onChoose={(form) => transition(() => void chooseForm(form))}
                onNew={() => transition(() => setCreatingForm(true))}
              />

              {creatingForm ? (
                <NewFormForm
                  origin={new URL(selected.form_url).origin}
                  busy={busy === "create-form" || busy === "scan"}
                  onCancel={() => setCreatingForm(false)}
                  onSubmit={createForm}
                />
              ) : null}

              {selectedForm ? (
                <details className="selected-form-panel">
                  <summary>
                    {t("Správa formuláře", "Form settings")} · {selectedForm.path_pattern}
                  </summary>
                  <div className="selected-form-toolbar">
                    <span>
                      <strong>{selectedForm.name}</strong>
                      <small>
                        {selectedForm.match_mode === "exact"
                          ? t("Přesná cesta", "Exact path")
                          : t("Celá větev", "Whole branch")}{" "}
                        ·{` `}
                        <code>{selectedForm.path_pattern}</code>
                      </small>
                    </span>
                    <a href={selectedForm.form_url} target="_blank" rel="noreferrer">
                      {t("Otevřít stránku", "Open page")}
                    </a>
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => transition(() => void scan())}
                    >
                      <ArrowClockwise size={16} className={busy === "scan" ? "spinning" : ""} />
                      {t("Znovu najít pole", "Find fields again")}
                    </button>
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={busy !== null || selectedForm.state === "draft"}
                      onClick={() =>
                        transition(
                          () =>
                            void setSelectedFormState(
                              selectedForm.state === "paused" ? "configured" : "paused",
                            ),
                        )
                      }
                    >
                      {selectedForm.state === "paused"
                        ? t("Zapnout formulář", "Turn form on")
                        : t("Pozastavit formulář", "Pause form")}
                    </button>
                  </div>
                  <details className="root-settings">
                    <summary>
                      {t("Technické nastavení formuláře", "Technical form settings")}
                    </summary>
                    <RootSelectorEditor
                      key={`${selectedForm.id}:${selectedForm.root_selector}`}
                      value={rootDraft}
                      savedValue={selectedForm.root_selector}
                      onChange={setRootDraft}
                      busy={busy !== null}
                      onSave={async (value) => {
                        await saveRootSelector(value);
                      }}
                    />
                  </details>
                </details>
              ) : null}

              <fieldset className="mapping-editor" disabled={busy !== null}>
                <legend className="visually-hidden">
                  {t("Mapování formuláře", "Form mapping")}
                </legend>
                <div className="mapping-heading">
                  <div>
                    <span className="section-number">2</span>
                    <span>
                      <strong>{t("Zkontrolujte nalezená pole", "Review the fields found")}</strong>
                      <small>
                        {t(
                          `${mappedCount} kontrolních polí · ostatní slouží jako kontext`,
                          `${mappedCount} checked ${mappedCount === 1 ? "field" : "fields"} · the rest serve as context`,
                        )}
                      </small>
                    </span>
                  </div>
                  <button
                    className="secondary-button add-field-button"
                    type="button"
                    onClick={addField}
                    aria-label={t("Přidat pole ručně", "Add field manually")}
                  >
                    <Plus size={15} />
                    <span className="add-field-label">
                      {t("Přidat pole ručně", "Add field manually")}
                    </span>
                  </button>
                </div>

                {fields.length > 0 ? (
                  <ul
                    className="mapping-list"
                    aria-label={t("Mapování polí formuláře", "Form field mapping")}
                  >
                    {fields.map((field, index) => (
                      <MappingRow
                        key={field.id ?? `${field.context}:${field.selector}`}
                        field={field}
                        onChange={(patch) => updateField(index, patch)}
                        onRemove={() =>
                          setFields((current) => current.filter((_, item) => item !== index))
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="mapping-empty">
                    <Wrench size={29} weight="duotone" />
                    <div>
                      <strong>{t("Zatím nemáme žádné pole", "No fields yet")}</strong>
                      <p>
                        {t(
                          "Načtěte stránku znovu, nebo přidejte pole ručně pomocí jeho CSS selektoru.",
                          "Load the page again, or add a field manually by its CSS selector.",
                        )}
                      </p>
                    </div>
                    <button className="secondary-button" type="button" onClick={addField}>
                      {t("Přidat první pole", "Add first field")}
                    </button>
                  </div>
                )}
              </fieldset>
              <div className="mapping-footer">
                <span aria-live="polite">
                  {dirty
                    ? t("Neuložené změny", "Unsaved changes")
                    : t(
                        `Uloženo · konfigurace v${selectedForm?.config_version ?? 1}`,
                        `Saved · configuration v${selectedForm?.config_version ?? 1}`,
                      )}
                </span>
                {dirty ? (
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={busy !== null}
                    onClick={discardDraft}
                  >
                    {t("Zahodit změny", "Discard changes")}
                  </button>
                ) : null}
                <button
                  className="primary-button"
                  type="button"
                  disabled={!dirty || fields.length === 0 || busy !== null}
                  onClick={() => void saveDraft()}
                >
                  <CheckSquare size={17} />{" "}
                  {busy === "save"
                    ? t("Ukládám…", "Saving…")
                    : t("Uložit mapování", "Save mapping")}
                </button>
              </div>

              <details className="integration-guardrail">
                <summary>
                  {t("Chování uložené konfigurace", "Saved configuration behaviour")}
                </summary>
                <span>
                  <strong>
                    {!assistanceActive
                      ? t("Asistence není spuštěná", "Assistance is not running")
                      : assistedFieldCount + guardCount > 0
                        ? t("Asistence je aktivní", "Assistance is active")
                        : t("Teď pouze měříme", "Only measuring for now")}
                  </strong>{" "}
                  {assistanceActive && assistedFieldCount + guardCount > 0
                    ? assistanceDescription
                    : t(
                        "Žádná hodnota ve formuláři ani objednávce se automaticky nezmění.",
                        "No value in the form or the order changes automatically.",
                      )}
                </span>
              </details>

              <ConfigHistory
                versions={versions}
                busy={busy}
                onRollback={(version) => transition(() => void rollback(version))}
              />

              <details className="installation-settings" open={!receivedData}>
                <summary>{t("Instalace kódu", "Code installation")}</summary>
                <InstallScriptSection integration={selected} />
              </details>

              <ActivationSection
                integration={selected}
                mappedCount={totalMappedCount}
                busy={busy === "state"}
                onState={(state) => transition(() => void setState(state))}
              />
            </section>
          ) : (
            <EmptyDetail
              loading={loading || busy === "detail"}
              onNew={() => transition(() => setCreating(true))}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function IntegrationList({
  integrations,
  selectedId,
  loading,
  onChoose,
  onNew,
}: {
  readonly integrations: readonly Integration[];
  readonly selectedId: string | null;
  readonly loading: boolean;
  readonly onChoose: (integration: Integration) => void;
  readonly onNew: () => void;
}) {
  return (
    <aside className="integration-list" aria-label={t("Seznam napojení", "Connection list")}>
      <div className="integration-list-head">
        <span>{t("Napojení", "Connections")}</span>
        <strong>{integrations.length}</strong>
      </div>
      {loading && integrations.length === 0 ? (
        <div className="list-placeholder">{t("Načítám…", "Loading…")}</div>
      ) : integrations.length === 0 ? (
        <div className="list-empty">
          <LinkSimple size={23} />
          <strong>{t("Žádné napojení", "No connections")}</strong>
          <p>
            {t(
              "Začněte webem a URL prvního formuláře.",
              "Start with a website and the URL of its first form.",
            )}
          </p>
          <button className="secondary-button" type="button" onClick={onNew}>
            {t("Přidat", "Add")}
          </button>
        </div>
      ) : (
        integrations.map((integration) => (
          <button
            key={integration.id}
            type="button"
            className={`integration-list-item ${selectedId === integration.id ? "selected" : ""}`}
            onClick={() => void onChoose(integration)}
          >
            <span className={`list-status ${runtimeTone(integration)}`} />
            <span>
              <strong>{integration.name}</strong>
              <small>
                {runtimeLabel(integration)} · {formCountLabel(integration.forms.length)}
              </small>
            </span>
            <ArrowRight size={15} />
          </button>
        ))
      )}
    </aside>
  );
}

function EmptyDetail({
  loading,
  onNew,
}: {
  readonly loading: boolean;
  readonly onNew: () => void;
}) {
  return (
    <section className="empty-detail">
      <h2>
        {loading
          ? t("Načítám weby…", "Loading websites…")
          : t("Vyberte nebo přidejte web", "Select or add a website")}
      </h2>
      <p>
        {t(
          "Jeden web může mít více formulářů, ale stále jen jeden instalační kód.",
          "One website can have several forms but still only one installation code.",
        )}
      </p>
      {!loading ? (
        <button className="primary-button" type="button" onClick={onNew}>
          <Plus size={16} /> {t("Přidat web", "Add website")}
        </button>
      ) : null}
    </section>
  );
}

function OnboardingSteps({ current }: { readonly current: number }) {
  const steps = [
    t("Web a formuláře", "Website and forms"),
    t("Mapování polí", "Field mapping"),
    t("Instalace a ověření", "Installation and verification"),
  ];
  return (
    <ol className="onboarding-steps">
      {steps.map((step, index) => {
        const number = index + 1;
        return (
          <li
            key={step}
            className={number < current ? "done" : number === current ? "current" : ""}
          >
            <span>{number < current ? <CheckCircle size={16} weight="fill" /> : number}</span>
            <strong>{step}</strong>
          </li>
        );
      })}
    </ol>
  );
}

function IntegrationTopbar() {
  return (
    <header className="integration-topbar">
      <a className="brand" href="/">
        <span className="brand-mark">
          <CheckCircle size={28} weight="duotone" />
        </span>
        Checkdrop
      </a>
      <span className="topbar-divider" />
      <span className="breadcrumbs">
        <span>{t("Administrace", "Administration")}</span>
        <span>/</span>
        <strong>{t("Napojení", "Connections")}</strong>
      </span>
      <span className="operator-chip">
        <ShieldCheck size={16} /> {t("Chráněná administrace", "Protected administration")}
      </span>
    </header>
  );
}
