import { ArrowClockwiseIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { intlLocale, t } from "../i18n";
import AdminNavigation from "./AdminNavigation";
import InstallationStatus from "./InstallationStatus";
import { api, messageFrom } from "./integrations/api";
import { type Integration, runtimeLabel } from "./integrations/model";

type Summary = {
  total: number;
  assist_shown: number;
  assist_applied: number;
  assist_kept: number;
  assist_undone: number;
};
const numbers = new Intl.NumberFormat(intlLocale);
export default function AdminDashboard() {
  const [period, setPeriod] = useState("7d");
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sites, setSites] = useState<readonly Integration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sitesError, setSitesError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly reloads the dashboard.
  useEffect(() => {
    const controller = new AbortController();
    setSitesError(null);
    void api<{ data: Integration[] }>("/integrations", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setSites(result.data);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setSitesError(messageFrom(reason));
      });
    return () => controller.abort();
  }, [revision]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly reloads the dashboard.
  useEffect(() => {
    const controller = new AbortController();
    setSummary(null);
    setError(null);
    const from = new Date(
      Date.now() - (period === "24h" ? 1 : Number.parseInt(period, 10)) * 86400000,
    ).toISOString();
    // page_size keeps the request cheap on servers that predate summary_only.
    const query = new URLSearchParams({ from, filter: "all", summary_only: "1", page_size: "1" });
    void fetch(`/checkdrop/v1/operator/observations?${query}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            t(
              "Souhrn se nepodařilo načíst. Zkuste obnovení.",
              "The summary could not be loaded. Try refreshing.",
            ),
          );
        const body = await response.json();
        const value = body?.summary;
        if (
          !value ||
          !["total", "assist_shown", "assist_applied", "assist_kept", "assist_undone"].every(
            (key) => Number.isFinite(value[key]) && value[key] >= 0,
          )
        )
          throw new Error(
            t("Server vrátil neplatný souhrn.", "The server returned an invalid summary."),
          );
        if (!controller.signal.aborted) setSummary(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(messageFrom(reason));
      });
    return () => controller.abort();
  }, [period, revision]);
  const monitor = `/monitor?period=${period}`;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/dashboard">
          Checkdrop
        </a>
        <span className="topbar-divider" />
        <span className="breadcrumbs">{t("Administrace", "Administration")}</span>
      </header>
      <AdminNavigation active="dashboard" />
      <main className="dashboard-main">
        <header className="dashboard-heading">
          <div className="dashboard-title">
            <h1>{t("Přehled", "Overview")}</h1>
            <p className="dashboard-eyebrow">{t("Všechny weby", "All websites")}</p>
          </div>
          <div className="dashboard-actions">
            <label>
              <span className="visually-hidden">{t("Období", "Period")}</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="24h">{t("24 hodin", "24 hours")}</option>
                <option value="7d">{t("7 dní", "7 days")}</option>
                <option value="30d">{t("30 dní", "30 days")}</option>
                <option value="90d">{t("90 dní", "90 days")}</option>
              </select>
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setRevision((value) => value + 1)}
              aria-label={t("Obnovit přehled", "Refresh overview")}
            >
              <ArrowClockwiseIcon size={18} />
            </button>
            <a className="primary-button" href={monitor}>
              {t("Otevřít monitor", "Open monitor")} <ArrowRightIcon size={16} />
            </a>
          </div>
        </header>
        {error ? (
          <p className="dashboard-error" role="alert">
            {error}
          </p>
        ) : null}
        <section
          className="dashboard-metrics"
          aria-label={t("Výsledky kontrol", "Check results")}
          aria-busy={!summary && !error}
        >
          {[
            {
              label: t("Zpracované kontroly", "Checks processed"),
              value: summary?.total,
              note: t("za vybrané období", "in the selected period"),
              href: monitor,
            },
            {
              label: t("Zobrazené opravy", "Fixes shown"),
              value: summary?.assist_shown,
              note: t("nabídnuté návštěvníkům", "offered to visitors"),
              href: monitor,
            },
            {
              label: t("Použité opravy", "Fixes applied"),
              value: summary?.assist_applied,
              note: t("kliknutím nebo bezpečnou úpravou", "by a click or a safe adjustment"),
              href: `${monitor}&outcome=applied`,
            },
            {
              label: t("Ponecháno / vráceno", "Kept / undone"),
              value: summary ? summary.assist_kept + summary.assist_undone : undefined,
              note: summary
                ? t(
                    `${numbers.format(summary.assist_kept)} ponecháno · ${numbers.format(summary.assist_undone)} vráceno`,
                    `${numbers.format(summary.assist_kept)} kept · ${numbers.format(summary.assist_undone)} undone`,
                  )
                : t("reakce návštěvníků", "visitor reactions"),
              href: monitor,
            },
          ].map((metric) => (
            <a key={metric.label} href={metric.href}>
              <span>{metric.label}</span>
              <strong>{metric.value === undefined ? "—" : numbers.format(metric.value)}</strong>
              <small>{metric.note}</small>
            </a>
          ))}
        </section>
        <div className="dashboard-content">
          <section className="dashboard-section dashboard-sites">
            <header>
              <h2>{t("Napojené weby", "Connected websites")}</h2>
              <a href="/integrations">
                {t("Spravovat napojení", "Manage connections")} <ArrowRightIcon size={16} />
              </a>
            </header>
            {sitesError ? (
              <p className="dashboard-error" role="alert">
                {sitesError}
              </p>
            ) : null}
            {!sites && !sitesError ? (
              <p role="status">{t("Načítám napojení…", "Loading connections…")}</p>
            ) : null}
            {sites?.length === 0 ? (
              <div className="dashboard-empty">
                <h3>{t("Připojte první web", "Connect your first website")}</h3>
                <p>
                  {t(
                    "Přidejte adresu formuláře a zkontrolujte rozpoznaná pole.",
                    "Add the form address and check the detected fields.",
                  )}
                </p>
                <a className="primary-button" href="/integrations">
                  {t("Připojit web", "Connect website")}
                </a>
              </div>
            ) : null}
            {sites && sites.length > 0 ? (
              <div className="dashboard-table-scroll">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>{t("Web", "Website")}</th>
                      <th>{t("Formuláře", "Forms")}</th>
                      <th>{t("Stav napojení", "Connection state")}</th>
                      <th>
                        <span className="visually-hidden">{t("Akce", "Actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((site) => (
                      <tr key={site.id}>
                        <td>
                          <strong>{site.name}</strong>
                          <small>{new URL(site.form_url).hostname}</small>
                        </td>
                        <td>
                          {site.forms.length} · {site.forms.map((form) => form.name).join(", ")}
                        </td>
                        <td>
                          <span
                            className={`dashboard-site-state ${site.state === "paused" ? "paused" : site.state === "shadow" && (site.activity?.observation_count_24h ?? 0) > 0 ? "receiving" : "pending"}`}
                          >
                            {runtimeLabel(site)}
                          </span>
                        </td>
                        <td>
                          <a
                            href={`/integrations?site=${encodeURIComponent(site.id)}`}
                            aria-label={t(`Upravit ${site.name}`, `Edit ${site.name}`)}
                          >
                            {t("Upravit", "Edit")} <ArrowRightIcon size={16} />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
          <div className="dashboard-side">
            <section className="dashboard-section dashboard-shortcuts">
              <header>
                <h2>{t("Rychlé akce", "Quick actions")}</h2>
              </header>
              <div className="dashboard-steps">
                <a href="/integrations">
                  <strong>{t("Připojit web", "Connect website")}</strong>
                  <p>
                    {t(
                      "Vložte skript a ověřte napojení.",
                      "Add the script and verify the connection.",
                    )}
                  </p>
                </a>
                <a href="/integrations">
                  <strong>{t("Zkontrolovat pole", "Review fields")}</strong>
                  <p>{t("Nastavte sledování a opravy.", "Set up monitoring and fixes.")}</p>
                </a>
                <a href="/playground">
                  <strong>{t("Vyzkoušet kontrolu", "Try a check")}</strong>
                  <p>
                    {t("Ověřte e-mail, telefon nebo adresu.", "Check an e-mail, phone or address.")}
                  </p>
                </a>
              </div>
            </section>
            <InstallationStatus />
          </div>
        </div>
      </main>
    </div>
  );
}
