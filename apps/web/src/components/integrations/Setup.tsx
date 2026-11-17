import {
  ArrowRightIcon as ArrowRight,
  CheckCircleIcon as CheckCircle,
  ClipboardIcon as Clipboard,
  CodeIcon as Code,
} from "@phosphor-icons/react";
import { useState } from "react";
import { t } from "../../i18n";
import {
  assistCountLabel,
  type ConfigVersion,
  formatDateTime,
  type Integration,
  observationCountLabel,
} from "./model";
import { snippetOrigin } from "./snippet";
export function ConfigHistory({
  versions,
  busy,
  onRollback,
}: {
  readonly versions: readonly ConfigVersion[];
  readonly busy: string | null;
  readonly onRollback: (version: number) => void;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);
  if (versions.length < 2) return null;
  return (
    <details className="config-history">
      <summary>
        {t("Historie konfigurace", "Configuration history")} ({versions.length})
      </summary>
      <div className="config-history-list">
        {versions.map((version) => (
          <div className="config-history-row" key={version.version}>
            <span>
              <strong>v{version.version}</strong>
              <small>
                {t(
                  `${version.field_count} polí`,
                  `${version.field_count} ${version.field_count === 1 ? "field" : "fields"}`,
                )}{" "}
                · {formatDateTime(version.created_at)}
              </small>
            </span>
            {version.current ? (
              <span className="current-version">{t("Aktuální", "Current")}</span>
            ) : confirming === version.version ? (
              <span className="rollback-confirm">
                <button type="button" className="quiet-button" onClick={() => setConfirming(null)}>
                  {t("Zrušit", "Cancel")}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() => onRollback(version.version)}
                >
                  {busy === `rollback:${version.version}`
                    ? t("Obnovuji…", "Restoring…")
                    : t("Potvrdit obnovu", "Confirm restore")}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="quiet-button"
                disabled={busy !== null}
                onClick={() => setConfirming(version.version)}
              >
                {t("Obnovit tuto verzi", "Restore this version")}
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

export function InstallScriptSection({ integration }: { readonly integration: Integration }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const value = integration.embed_script;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <section className="setup-section" aria-labelledby="install-script-title">
      <div className="setup-section-head">
        <span className="section-number">3</span>
        <div>
          <h3 id="install-script-title">
            {t("Vložte jeden řádek do e-shopu", "Add one line to your shop")}
          </h3>
          <p>
            {t(
              "Jednou do společné patičky. Kód automaticky vybere formulář podle stránky.",
              "Once, in the shared footer. The code picks the form by page automatically.",
            )}
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void copy()}>
          <Clipboard size={16} />{" "}
          {copied ? t("Zkopírováno", "Copied") : t("Kopírovat kód", "Copy code")}
        </button>
      </div>
      <div className="install-snippet">
        <Code size={20} weight="duotone" />
        <code>{integration.embed_script}</code>
      </div>
      <div className="developer-handoff simple">
        <CheckCircle size={19} weight="duotone" />
        <div>
          <strong>{t("To je celé", "That is all")}</strong>
          <p>
            {t(
              "Žádný balíček, GitHub ani serverový API klíč není potřeba.",
              "No package, GitHub or server API key is needed.",
            )}
          </p>
          <ol>
            <li>
              {t(
                "Správce webu vloží kód před koncové",
                "The website admin adds the code before the closing",
              )}{" "}
              <code>&lt;/body&gt;</code>{" "}
              {t("nebo do univerzální patičky.", "tag or into the shared footer.")}
            </li>
            <li>
              {t("Pokud e-shop používá CSP, povolí", "If the shop uses CSP, it allows")}{" "}
              <code>{snippetOrigin(integration.embed_script)}</code>{" "}
              {t("pro script a připojení.", "for scripts and connections.")}
            </li>
          </ol>
        </div>
        <a className="secondary-button" href="/monitor">
          {t("Otevřít monitor", "Open monitor")} <ArrowRight size={15} />
        </a>
      </div>
    </section>
  );
}

export function ActivationSection({
  integration,
  mappedCount,
  busy,
  onState,
}: {
  readonly integration: Integration;
  readonly mappedCount: number;
  readonly busy: boolean;
  readonly onState: (state: "shadow" | "paused") => void;
}) {
  const active = integration.state === "shadow";
  const observations = integration.activity?.observation_count_24h ?? 0;
  const received = observations > 0;
  const connected = Boolean(integration.activity?.last_key_used_at);
  const assistedFields = integration.forms
    .flatMap((form) => form.fields)
    .filter(
      (field) =>
        (field.canonical_field === "email" || field.canonical_field === "phone") &&
        field.validation_mode === "suggest",
    ).length;
  const automaticPhoneFields = integration.forms
    .flatMap((form) => form.fields)
    .filter(
      (field) => field.canonical_field === "phone" && field.validation_mode === "suggest",
    ).length;
  const heading = !active
    ? t("Spustit kontrolu formuláře", "Start checking the form")
    : received
      ? t("Data skutečně přijímáme", "Data is coming in")
      : connected
        ? t(
            "E-shop se připojil, čekáme na první kontrolu",
            "The shop has connected, waiting for the first check",
          )
        : t(
            "Shadow režim čeká na připojení e-shopu",
            "Monitor-only mode is waiting for the shop to connect",
          );
  const description = received
    ? automaticPhoneFields > 0
      ? t(
          `${observationCountLabel(observations)} za posledních 24 hodin. Bezpečné formátování telefonu lze vždy vrátit; ostatní hodnoty se bez potvrzení nemění.`,
          `${observationCountLabel(observations)} in the last 24 hours. Safe phone formatting can always be undone; other values never change without confirmation.`,
        )
      : t(
          `${observationCountLabel(observations)} za posledních 24 hodin. Zásahy se řídí uloženými pravidly polí.`,
          `${observationCountLabel(observations)} in the last 24 hours. Changes follow the saved field rules.`,
        )
    : active
      ? t(
          "Stav potvrdíme až po prvním skutečném požadavku z e-shopu.",
          "We confirm the status after the first real request from the shop.",
        )
      : t(
          "Uložte mapování, vložte instalační kód a spusťte bezpečný test.",
          "Save the mapping, add the installation code and start a safe test.",
        );
  return (
    <section className={`activation-section ${received ? "active" : ""}`}>
      <div>
        <span className="section-number">4</span>
        <h3>{heading}</h3>
        <p>{description}</p>
      </div>
      <div className="activation-checks">
        <span className={mappedCount > 0 ? "done" : ""}>
          <CheckCircle size={15} />{" "}
          {t(`${mappedCount} polí`, `${mappedCount} ${mappedCount === 1 ? "field" : "fields"}`)}
        </span>
        <span className={integration.embed_script ? "done" : ""}>
          <CheckCircle size={15} /> {t("Instalační kód", "Installation code")}
        </span>
        <span className={received ? "done" : ""}>
          <CheckCircle size={15} /> {t("Přijatá data", "Data received")}
        </span>
        {assistedFields > 0 ? (
          <span className="done">
            <CheckCircle size={15} /> {assistCountLabel(assistedFields)}
          </span>
        ) : null}
      </div>
      <button
        className={active ? "secondary-button" : "primary-button"}
        type="button"
        disabled={busy || (!active && mappedCount === 0)}
        onClick={() => onState(active ? "paused" : "shadow")}
      >
        {busy
          ? t("Ukládám…", "Saving…")
          : active
            ? t("Pozastavit", "Pause")
            : t("Zapnout kontrolu", "Turn on checks")}
      </button>
    </section>
  );
}
