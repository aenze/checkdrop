import {
  ArrowClockwiseIcon as ArrowClockwise,
  CaretDownIcon as CaretDown,
  CaretLeftIcon as CaretLeft,
  CaretRightIcon as CaretRight,
  CaretUpIcon as CaretUp,
  CheckCircleIcon as CheckCircle,
  ClockCountdownIcon as ClockCountdown,
  EyeIcon as Eye,
  GaugeIcon as Gauge,
  MagnifyingGlassIcon as MagnifyingGlass,
  PulseIcon as Pulse,
  ShieldCheckIcon as ShieldCheck,
  WarningCircleIcon as WarningCircle,
  XIcon as X,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { intlLocale, localeHeader, t } from "../i18n";
import AdminNavigation from "./AdminNavigation";
import CheckoutOutcomeIcon from "./CheckoutOutcomeIcon";
import { type CaseCheckout, CaseCheckoutDetail } from "./case-checkout";
import { startMonitorPolling } from "./monitor-polling";
import {
  type GroupedShadowObservationCase,
  groupObservationsByCase,
} from "./shadow-monitor-grouping";

type MonitorFilter = "all" | "changed" | "review";
type ObservationStatus = "valid" | "correctable" | "risky" | "invalid" | "unknown";
type ObservationOperation =
  | "name.validate"
  | "email.validate"
  | "phone.validate"
  | "address.validate"
  | "company_id.validate";
type AssistOutcomeFilter = "shown_only" | "applied" | "kept" | "undone" | "none";
type PeriodFilter = "24h" | "7d" | "30d" | "90d";

interface MonitorSite {
  readonly id: string;
  readonly name: string;
  readonly client_name: string;
}

interface MonitorQuery {
  readonly checkoutOutcome: string;
  /** Integration client identifier of one connected website, or "all". */
  readonly clientName: string;
  readonly filter: MonitorFilter;
  readonly operation: ObservationOperation | "all";
  readonly resultClass: ObservationStatus | "all";
  readonly assistOutcome: AssistOutcomeFilter | "all";
  readonly period: PeriodFilter;
  readonly formId: string | null;
  readonly search: string;
}

interface ShadowObservation {
  readonly id: string;
  readonly request_id: string;
  readonly operation: ObservationOperation;
  readonly client_name: string;
  readonly form_id: string | null;
  readonly form_name: string | null;
  readonly checkout_session_ref: string | null;
  readonly input_value: string;
  readonly proposed_value: string | null;
  readonly value_visibility: "full" | "masked_legacy";
  readonly input_preview: string;
  readonly proposed_preview: string | null;
  readonly changed: boolean;
  readonly status: ObservationStatus;
  readonly action: string;
  readonly issue_codes: readonly string[];
  readonly evidence_sources: readonly string[];
  readonly server_latency_ms: number;
  readonly assist_shown_at: string | null;
  readonly assist_outcome: "applied" | "kept" | "undone" | null;
  readonly assist_outcome_at: string | null;
  readonly assist_changed_fields?: readonly string[];
  readonly observed_at: string;
  readonly expires_at: string;
}

interface ShadowObservationList {
  readonly object: "shadow_observation_list";
  readonly request_id: string;
  readonly data: readonly ShadowObservation[];
  readonly summary: {
    readonly total: number;
    readonly proposed_changes: number;
    readonly review_required: number;
    readonly average_server_latency_ms: number;
    readonly p95_server_latency_ms: number;
    readonly assist_shown: number;
    readonly assist_applied: number;
    readonly assist_kept: number;
    readonly assist_undone: number;
  };
  readonly pagination: {
    readonly page: number;
    readonly page_size: number;
    readonly total: number;
    readonly pages: number;
  };
}

type ShadowObservationCase = GroupedShadowObservationCase<ShadowObservation>;

const emptyPayload: ShadowObservationList = {
  object: "shadow_observation_list",
  request_id: "",
  data: [],
  summary: {
    total: 0,
    proposed_changes: 0,
    review_required: 0,
    average_server_latency_ms: 0,
    p95_server_latency_ms: 0,
    assist_shown: 0,
    assist_applied: 0,
    assist_kept: 0,
    assist_undone: 0,
  },
  pagination: { page: 1, page_size: 25, total: 0, pages: 1 },
};

const numberFormatter = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 });
const timeFormatter = new Intl.DateTimeFormat(intlLocale, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const caseTimeFormatter = new Intl.DateTimeFormat(intlLocale, {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default function ShadowMonitor() {
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 821px)");
    const sync = () => setFiltersExpanded(desktop.matches);
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, []);
  const [payload, setPayload] = useState<ShadowObservationList>(emptyPayload);
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [operation, setOperation] = useState<ObservationOperation | "all">("all");
  const [resultClass, setResultClass] = useState<ObservationStatus | "all">("all");
  const [assistOutcome, setAssistOutcome] = useState<AssistOutcomeFilter | "all">("all");
  const [period, setPeriod] = useState<PeriodFilter>("7d");
  const [checkoutOutcome, setCheckoutOutcome] = useState("all");
  const [clientName, setClientName] = useState("all");
  const [sites, setSites] = useState<readonly MonitorSite[]>([]);
  const [formId, setFormId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [expandedCases, setExpandedCases] = useState<ReadonlySet<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [manualRefreshAt, setManualRefreshAt] = useState(0);
  const [checkouts, setCheckouts] = useState<CaseCheckout[]>([]);
  const [checkoutError, setCheckoutError] = useState(false);
  const sessionKey = [
    ...new Set(payload.data.map((row) => row.checkout_session_ref).filter(Boolean)),
  ]
    .sort()
    .join(",");
  // Polls replace `payload` every 30 s; refetch checkouts only when the visible cases change
  // (or on a manual refresh) and keep the previous rows meanwhile so the column does not flicker.
  // biome-ignore lint/correctness/useExhaustiveDependencies: manualRefreshAt explicitly reloads checkouts.
  useEffect(() => {
    const controller = new AbortController();
    setCheckoutError(false);
    if (!sessionKey) {
      setCheckouts([]);
      return () => controller.abort();
    }
    const query = new URLSearchParams({
      from: new Date(Date.now() - 90 * 86400000).toISOString(),
      include_tests: "1",
    });
    for (const ref of sessionKey.split(",")) query.append("session_ref", ref);
    void fetch(`/checkdrop/v1/operator/checkout-sessions?${query}`, {
      headers: { ...localeHeader },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Checkout unavailable");
        const body = await response.json();
        if (!controller.signal.aborted) setCheckouts(body.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCheckoutError(true);
      });
    return () => controller.abort();
  }, [sessionKey, manualRefreshAt]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/checkdrop/v1/operator/integrations", {
      headers: { ...localeHeader, Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Integrations unavailable");
        const body = (await response.json()) as { data?: unknown };
        if (!controller.signal.aborted && Array.isArray(body.data)) {
          setSites(
            body.data
              .filter(
                (site): site is MonitorSite =>
                  !!site &&
                  typeof site === "object" &&
                  typeof (site as MonitorSite).id === "string" &&
                  typeof (site as MonitorSite).name === "string" &&
                  typeof (site as MonitorSite).client_name === "string",
              )
              .map((site) => ({ id: site.id, name: site.name, client_name: site.client_name })),
          );
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(
    () =>
      startMonitorPolling({
        load: (signal) =>
          fetchShadowObservations(
            page,
            {
              filter,
              operation,
              resultClass,
              assistOutcome,
              period,
              formId,
              search,
              checkoutOutcome,
              clientName,
            },
            signal,
          ),
        receive: (nextPayload) => {
          setPayload(nextPayload);
          setError(null);
          setRefreshedAt(new Date(Math.max(Date.now(), manualRefreshAt)));
        },
        fail: (caught) =>
          setError(
            caught instanceof Error
              ? caught.message
              : t("Monitor se nepodařilo načíst.", "The monitor could not be loaded."),
          ),
        refreshing: setRefreshing,
      }),
    [
      assistOutcome,
      filter,
      formId,
      manualRefreshAt,
      operation,
      page,
      period,
      resultClass,
      search,
      checkoutOutcome,
      clientName,
    ],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchText.trim();
      const boundedSearch = nextSearch.length >= 2 ? nextSearch : "";
      if (boundedSearch !== search) {
        setPage(1);
        setSearch(boundedSearch);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, searchText]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialPeriod = params.get("period");
    if (["24h", "7d", "30d", "90d"].includes(initialPeriod ?? ""))
      setPeriod(initialPeriod as PeriodFilter);
    const initialOutcome = params.get("outcome");
    if (["applied", "kept", "undone", "shown_only", "none"].includes(initialOutcome ?? ""))
      setAssistOutcome(initialOutcome as AssistOutcomeFilter);
    const initialSite = params.get("web");
    if (initialSite && isClientName(initialSite)) setClientName(initialSite);
  }, []);

  useEffect(() => {
    if (page > payload.pagination.pages) setPage(payload.pagination.pages);
  }, [page, payload.pagination.pages]);

  const visibleCases = groupObservationsByCase(payload.data);
  const siteOptions = monitorSiteOptions(sites, payload.data);
  const siteNames = new Map(siteOptions.map(([value, label]) => [value, label]));

  function toggleCase(caseKey: string) {
    setExpandedCases((current) => {
      const next = new Set(current);
      if (next.has(caseKey)) next.delete(caseKey);
      else {
        next.clear();
        next.add(caseKey);
      }
      return next;
    });
  }

  return (
    <div className="app-shell monitor-app-shell">
      <MonitorTopbar
        refreshing={refreshing}
        refreshedAt={refreshedAt}
        onRefresh={() => setManualRefreshAt(Date.now())}
      />
      <AdminNavigation active="monitor" />

      <main className="monitor-workspace">
        <section className="monitor-heading">
          <div className="monitor-title">
            <h1>Monitor</h1>
            <p>{t("Kontroly a reakce zákazníků", "Checks and customer responses")}</p>
          </div>
          <div className="monitor-guardrail" role="status">
            <ShieldCheck size={21} weight="duotone" aria-hidden="true" />
            <span>
              <strong>{t("Konkrétní zákaznické hodnoty", "Actual customer values")}</strong>
              <small>
                {t(
                  "Propojené s rozhodnutím, šifrované a mazané po 90 dnech",
                  "Linked to the decision, encrypted and deleted after 90 days",
                )}
              </small>
            </span>
          </div>
        </section>

        <section
          className="monitor-metrics"
          aria-label={t("Souhrn provozu a rozhodnutí", "Traffic and decision summary")}
        >
          <MonitorMetric
            icon={<Pulse size={19} />}
            label={t("Zpracované kontroly", "Checks processed")}
            value={payload.summary.total}
            note={
              period === "24h"
                ? t("za posledních 24 hodin", "in the last 24 hours")
                : t(
                    `za posledních ${period.slice(0, -1)} dní`,
                    `in the last ${period.slice(0, -1)} days`,
                  )
            }
            tone="blue"
          />
          <MonitorMetric
            icon={<CheckCircle size={19} />}
            label={t("Zobrazené opravy", "Fixes shown")}
            value={payload.summary.assist_shown}
            note={t("nabídnuté konkrétním zákazníkům", "offered to individual customers")}
            tone="green"
          />
          <MonitorMetric
            icon={<Gauge size={19} />}
            label={t("Použité opravy", "Fixes applied")}
            value={payload.summary.assist_applied}
            note={t("evidovaná použití v tomto období", "recorded uses in this period")}
            tone="violet"
          />
          <MonitorMetric
            icon={<ClockCountdown size={19} />}
            label={t("Ponecháno / vráceno", "Kept / undone")}
            value={payload.summary.assist_kept + payload.summary.assist_undone}
            note={t(
              `${numberFormatter.format(payload.summary.assist_kept)} ponecháno · ${numberFormatter.format(payload.summary.assist_undone)} vráceno`,
              `${numberFormatter.format(payload.summary.assist_kept)} kept · ${numberFormatter.format(payload.summary.assist_undone)} undone`,
            )}
            tone="amber"
          />
        </section>

        <section
          className="monitor-table-shell"
          aria-label={t("Zpracované kontroly", "Checks processed")}
        >
          <header className="monitor-toolbar">
            <label className="monitor-search">
              <span className="visually-hidden">
                {t("Hledat zákazníka nebo případ", "Search for a customer or case")}
              </span>
              <MagnifyingGlass size={16} aria-hidden="true" />
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={t(
                  "Jméno, firma, e-mail, telefon, IČO nebo ID případu",
                  "Name, company, email, phone, IČO or case ID",
                )}
                autoComplete="off"
                spellCheck={false}
              />
              {searchText ? (
                <button
                  type="button"
                  aria-label={t("Vymazat hledání", "Clear search")}
                  onClick={() => setSearchText("")}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </label>
            <button
              className="monitor-reset"
              type="button"
              onClick={() => {
                setPage(1);
                setFilter("all");
                setOperation("all");
                setResultClass("all");
                setAssistOutcome("all");
                setCheckoutOutcome("all");
                setClientName("all");
                setFormId(null);
                setSearchText("");
                setSearch("");
                setPeriod("7d");
              }}
            >
              {t("Vymazat filtry", "Clear filters")}
            </button>
            <details
              className="monitor-filter-options"
              open={filtersExpanded}
              onToggle={(event) => setFiltersExpanded(event.currentTarget.open)}
            >
              <summary>
                {t("Filtry", "Filters")}{" "}
                <span className="filter-summary-copy">
                  {period === "24h"
                    ? t("24 hodin", "24 hours")
                    : t(`${period.slice(0, -1)} dní`, `${period.slice(0, -1)} days`)}
                  {clientName !== "all" ? ` · ${siteNames.get(clientName) ?? clientName}` : ""}
                  {[operation, resultClass, assistOutcome, checkoutOutcome].some(
                    (value) => value !== "all",
                  )
                    ? t(" · upravený výběr", " · custom selection")
                    : t(" · vše", " · all")}
                </span>
              </summary>
              <fieldset className="monitor-filter-selects">
                <legend className="visually-hidden">
                  {t("Podrobné filtry", "Detailed filters")}
                </legend>
                <MonitorSelect
                  label={t("Web", "Website")}
                  value={clientName}
                  options={[["all", t("Všechny weby", "All websites")], ...siteOptions]}
                  onChange={(value) => {
                    setPage(1);
                    setFormId(null);
                    setClientName(value);
                  }}
                />
                <MonitorSelect
                  label={t("Stav košíku", "Checkout status")}
                  value={checkoutOutcome}
                  options={[
                    ["all", t("Všechny košíky", "All checkouts")],
                    ["completed", t("Dokončení zachyceno", "Completion recorded")],
                    ["active", t("Rozpracované", "In progress")],
                    ["abandoned", t("Pravděpodobně opuštěné", "Probably abandoned")],
                    ["unmeasured", t("Bez měření", "Not measured")],
                  ]}
                  onChange={(value) => {
                    setPage(1);
                    setCheckoutOutcome(value);
                  }}
                />
                <MonitorSelect
                  label={t("Období", "Period")}
                  value={period}
                  options={[
                    ["24h", t("24 hodin", "24 hours")],
                    ["7d", t("7 dní", "7 days")],
                    ["30d", t("30 dní", "30 days")],
                    ["90d", t("90 dní", "90 days")],
                  ]}
                  onChange={(value) => {
                    setPage(1);
                    setPeriod(value as PeriodFilter);
                  }}
                />
                <MonitorSelect
                  label={t("Pole", "Field")}
                  value={operation}
                  options={[
                    ["all", t("Všechna pole", "All fields")],
                    ["name.validate", t("Jméno", "Name")],
                    ["email.validate", t("E-mail", "Email")],
                    ["phone.validate", t("Telefon", "Phone")],
                    ["address.validate", t("Adresa", "Address")],
                    ["company_id.validate", "IČO"],
                  ]}
                  onChange={(value) => {
                    setPage(1);
                    setOperation(value as ObservationOperation | "all");
                  }}
                />
                <MonitorSelect
                  label={t("Kvalita údajů", "Data quality")}
                  value={resultClass}
                  options={[
                    ["all", t("Všechny výsledky", "All results")],
                    ["valid", t("V pořádku", "Valid")],
                    ["correctable", t("Návrh změny", "Suggested change")],
                    ["risky", t("K prověření", "To review")],
                    ["invalid", t("Neplatné", "Invalid")],
                    ["unknown", t("Nedostupné", "Unavailable")],
                  ]}
                  onChange={(value) => {
                    setPage(1);
                    setResultClass(value as ObservationStatus | "all");
                  }}
                />
                <MonitorSelect
                  label={t("Reakce na opravu", "Response to fix")}
                  value={assistOutcome}
                  options={[
                    ["all", t("Všechny reakce", "All responses")],
                    ["applied", t("Použito", "Applied")],
                    ["kept", t("Ponecháno", "Kept")],
                    ["undone", t("Vráceno", "Undone")],
                    ["shown_only", t("Bez rozhodnutí", "No decision")],
                    ["none", t("Nezobrazeno", "Not shown")],
                  ]}
                  onChange={(value) => {
                    setPage(1);
                    setAssistOutcome(value as AssistOutcomeFilter | "all");
                  }}
                />
              </fieldset>
            </details>
            {formId ? (
              <fieldset className="monitor-active-filters">
                <legend className="visually-hidden">
                  {t("Aktivní výběr", "Active selection")}
                </legend>
                {formId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPage(1);
                      setFormId(null);
                    }}
                  >
                    {t("Jeden formulář ×", "One form ×")}
                  </button>
                ) : null}
              </fieldset>
            ) : null}
            <div className="monitor-table-state">
              <span className={refreshing ? "refresh-dot working" : "refresh-dot"} />
              {refreshing
                ? t("Načítám", "Loading")
                : t("Automatická obnova po 30 s", "Auto-refresh every 30 s")}
            </div>
          </header>

          {error ? (
            <div className="monitor-error" role="alert">
              <WarningCircle size={20} aria-hidden="true" />
              <span>
                <strong>{t("Monitor není dostupný", "Monitor is unavailable")}</strong>
                <small>{error}</small>
              </span>
              <button type="button" onClick={() => setManualRefreshAt(Date.now())}>
                {t("Zkusit znovu", "Try again")}
              </button>
            </div>
          ) : null}

          <div className="monitor-table-scroll">
            <div className="monitor-list-heading" aria-hidden="true">
              <span>{t("Zákazník · web · formulář", "Customer · website · form")}</span>
              <span>{t("Kontrolovaná pole", "Checked fields")}</span>
              <span>{t("Reakce", "Response")}</span>
              <span>{t("Výsledek", "Result")}</span>
              <span />
            </div>
            <div className="monitor-case-list">
              {visibleCases.map((customerCase) => (
                <ObservationCaseCard
                  key={customerCase.key}
                  customerCase={customerCase}
                  checkouts={checkouts.filter((r) => r.session_ref === customerCase.sessionRef)}
                  checkoutError={checkoutError}
                  siteName={siteNames.get(customerCase.clientName) ?? customerCase.clientName}
                  expanded={expandedCases.has(customerCase.key)}
                  onToggle={() => toggleCase(customerCase.key)}
                  onSelectForm={(selectedFormId) => {
                    setPage(1);
                    setFormId(selectedFormId);
                  }}
                />
              ))}
            </div>
            {!error && !refreshing && visibleCases.length === 0 ? (
              <div className="monitor-empty">
                <strong>
                  {search
                    ? t("Nic jsme nenašli", "Nothing found")
                    : payload.summary.total === 0
                      ? t(
                          "Čekám na první data z e-shopu",
                          "Waiting for the first data from the shop",
                        )
                      : t("Tomuto filtru nic neodpovídá", "Nothing matches this filter")}
                </strong>
                <span>
                  {search
                    ? t(
                        "Zkuste jinou část jména, firmy, e-mailu, telefonu, IČO nebo ID případu.",
                        "Try another part of the name, company, email, phone, IČO or case ID.",
                      )
                    : payload.summary.total === 0
                      ? t(
                          "Jakmile serverová integrace zavolá kontrolu kontaktu, adresy nebo IČO, řádek se objeví zde.",
                          "A row appears here once the server integration calls a contact, address or IČO check.",
                        )
                      : t(
                          "Vyberte jiný filtr a zobrazte další přijaté kontroly.",
                          "Choose another filter to see more received checks.",
                        )}
                </span>
              </div>
            ) : null}
          </div>

          <footer className="monitor-footer">
            <span>
              {t(
                `Zobrazeno ${numberFormatter.format(visibleCases.length)} případů z ${numberFormatter.format(payload.pagination.total)}`,
                `Showing ${numberFormatter.format(visibleCases.length)} of ${numberFormatter.format(payload.pagination.total)} ${payload.pagination.total === 1 ? "case" : "cases"}`,
              )}
            </span>
            <MonitorPagination page={page} pages={payload.pagination.pages} onPage={setPage} />
            <span>
              {t(
                "Nové hodnoty jsou plné; starší maskované záznamy nelze zpětně obnovit",
                "New values are stored in full; older masked records cannot be restored",
              )}
            </span>
          </footer>
        </section>
      </main>
    </div>
  );
}

function MonitorTopbar({
  refreshing,
  refreshedAt,
  onRefresh,
}: {
  refreshing: boolean;
  refreshedAt: Date | null;
  onRefresh: () => void;
}) {
  return (
    <header className="topbar monitor-topbar">
      <a className="brand" href="/" aria-label="Checkdrop">
        <span className="brand-mark">
          <CheckCircle size={31} weight="bold" aria-hidden="true" />
        </span>
        <span>Checkdrop</span>
      </a>
      <span className="topbar-divider" aria-hidden="true" />
      <nav className="breadcrumbs" aria-label={t("Drobečková navigace", "Breadcrumbs")}>
        <span>{t("Integrace", "Integrations")}</span>
        <span aria-hidden="true">/</span>
        <strong>Shadow monitor</strong>
      </nav>
      <span className="pilot-chip monitor-mode-chip">
        <Eye size={15} weight="fill" aria-hidden="true" />
        {t("Provoz formulářů", "Form traffic")}
      </span>
      <div className="topbar-actions monitor-actions">
        <span className="last-refresh">
          {refreshedAt
            ? t(
                `Aktualizováno ${timeFormatter.format(refreshedAt)}`,
                `Updated ${timeFormatter.format(refreshedAt)}`,
              )
            : t("Čekám na data", "Waiting for data")}
        </span>
        <button
          type="button"
          className="monitor-refresh"
          aria-label={t("Obnovit shadow monitor", "Refresh shadow monitor")}
          onClick={onRefresh}
          disabled={refreshing}
        >
          <ArrowClockwise size={18} aria-hidden="true" />
          {t("Obnovit", "Refresh")}
        </button>
      </div>
    </header>
  );
}

function MonitorMetric({
  icon,
  label,
  value,
  suffix = "",
  note,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  suffix?: string;
  note: string;
  tone: "blue" | "green" | "violet" | "amber";
}) {
  return (
    <div className="monitor-metric">
      <span className={`monitor-metric-icon ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span className="monitor-metric-value">
        <small>{label}</small>
        <strong>
          {numberFormatter.format(value)}
          {suffix}
        </strong>
        <em>{note}</em>
      </span>
    </div>
  );
}

function MonitorSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="monitor-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function MonitorPagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  return (
    <nav
      className="monitor-pagination"
      aria-label={t("Stránkování shadow monitoru", "Shadow monitor pagination")}
    >
      <button
        type="button"
        aria-label={t("Předchozí stránka", "Previous page")}
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
      >
        <CaretLeft size={14} aria-hidden="true" />
      </button>
      <span>
        {numberFormatter.format(page)} / {numberFormatter.format(pages)}
      </span>
      <button
        type="button"
        aria-label={t("Další stránka", "Next page")}
        onClick={() => onPage(Math.min(pages, page + 1))}
        disabled={page >= pages}
      >
        <CaretRight size={14} aria-hidden="true" />
      </button>
    </nav>
  );
}

function ObservationCaseCard({
  customerCase,
  siteName,
  expanded,
  onToggle,
  onSelectForm,
  checkouts,
  checkoutError,
}: {
  customerCase: ShadowObservationCase;
  siteName: string;
  checkouts: CaseCheckout[];
  checkoutError: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelectForm: (formId: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [expanded]);
  const overview = summarizeCase(customerCase.observations);
  const identity = customerCaseIdentity(customerCase);
  const detailId = `case-details-${customerCase.key.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <article className={`monitor-case-card${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="monitor-case-summary"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className="case-identity">
          <strong title={identity}>{identity}</strong>
          <CheckoutOutcomeIcon rows={checkouts} unavailable={checkoutError} />
          <small>
            {customerCase.sessionRef
              ? `#${customerCase.sessionRef.slice(0, 8)}`
              : t("Nespárovaný záznam", "Unpaired record")}
            {" · "}
            {caseTimeFormatter.format(new Date(customerCase.latestObservedAt))} · {siteName} ·{" "}
            {customerCase.formName ?? t("Obecná integrace", "General integration")}
          </small>
        </span>
        <span className="case-field-overview">
          {overview.fields.map((field) => (
            <span
              key={field.operation}
              className={`case-field-pill ${field.state}`}
              title={`${field.label}: ${field.stateLabel}`}
            >
              {field.label}
              {field.count > 1 ? ` ×${field.count}` : ""}
              <small>{field.stateLabel}</small>
            </span>
          ))}
        </span>
        <span className="case-totals">
          <strong>
            {t(
              `${numberFormatter.format(customerCase.observations.length)} kontrol`,
              `${numberFormatter.format(customerCase.observations.length)} ${customerCase.observations.length === 1 ? "check" : "checks"}`,
            )}
          </strong>
          <small>{overview.note}</small>
        </span>
        <CaseStatusBadge overview={overview} />
        <span className="case-expand-icon" aria-hidden="true">
          {expanded ? <CaretUp size={17} /> : <CaretDown size={17} />}
        </span>
      </button>

      {expanded ? (
        <section
          className="monitor-case-details"
          id={detailId}
          aria-label={t(`Detail případu ${identity}`, `Case details: ${identity}`)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onToggle();
            }
          }}
        >
          <header className="case-drawer-heading">
            <strong>{identity}</strong>
            <button ref={closeRef} className="secondary-button" type="button" onClick={onToggle}>
              <X size={16} aria-hidden="true" /> {t("Zavřít", "Close")}
            </button>
          </header>
          <CaseCheckoutDetail rows={checkouts} />
          <header className="case-detail-meta">
            <span>
              <strong>
                {customerCase.formName ?? t("Obecná integrace", "General integration")}
              </strong>
              <small>
                {siteName}
                {siteName !== customerCase.clientName ? ` · ${customerCase.clientName}` : ""}
              </small>
            </span>
            {customerCase.formId ? (
              <button type="button" onClick={() => onSelectForm(customerCase.formId as string)}>
                {t("Zobrazit jen tento formulář", "Show only this form")}
              </button>
            ) : null}
          </header>
          <div className="case-detail-scroll">
            <table className="case-detail-table">
              <thead>
                <tr>
                  <th>{t("Pole", "Field")}</th>
                  <th>{t("Přijatá hodnota", "Received value")}</th>
                  <th>{t("Návrh Checkdrop", "Checkdrop suggestion")}</th>
                  <th>{t("Výsledek", "Result")}</th>
                  <th>{t("Reakce zákazníka", "Customer response")}</th>
                  <th>{t("Důvod, zdroj a čas validátoru", "Reason, source and validator time")}</th>
                </tr>
              </thead>
              <tbody>
                {customerCase.observations.map((observation) => (
                  <CaseDetailRow key={observation.id} observation={observation} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </article>
  );
}

function CaseDetailRow({ observation }: { observation: ShadowObservation }) {
  const issue = observation.issue_codes[0];
  const field = operationField(observation.operation);
  return (
    <tr className={observation.changed ? "has-change" : ""}>
      <td data-label={t("Pole", "Field")}>
        <small>{caseTimeFormatter.format(new Date(observation.observed_at))}</small>
        <span className={`field-pill ${field.tone}`}>{field.label}</span>
      </td>
      <td
        className="preview-value"
        data-label={t("Přijato", "Received")}
        title={observation.input_value}
      >
        {observation.input_value}
        {observation.value_visibility === "masked_legacy" ? (
          <small className="legacy-value">
            {t("starší maskovaný záznam", "older masked record")}
          </small>
        ) : null}
      </td>
      <td
        className={observation.changed ? "preview-value proposed" : "no-change"}
        data-label={t("Návrh", "Suggestion")}
        title={observation.proposed_value ?? undefined}
      >
        {observation.changed ? observation.proposed_value : t("Bez změny", "No change")}
      </td>
      <td data-label={t("Výsledek", "Result")}>
        <StatusBadge status={observation.status} changed={observation.changed} />
      </td>
      <td data-label={t("Reakce", "Response")}>
        <AssistOutcomeBadge observation={observation} />
      </td>
      <td className="monitor-reason" data-label={t("Důvod", "Reason")}>
        <span>{issue ? issueLabel(issue) : t("Bez zjištěné vady", "No issue found")}</span>
        {(observation.assist_changed_fields?.length ?? 0) > 0 ? (
          <small>
            {t("Změněno:", "Changed:")}{" "}
            {(observation.assist_changed_fields ?? []).map(changedFieldLabel).join(", ")}
          </small>
        ) : null}
        <small>
          {observation.evidence_sources.map(sourceLabel).join(" · ") || "Checkdrop"} ·{" "}
          {numberFormatter.format(observation.server_latency_ms)} ms
        </small>
      </td>
    </tr>
  );
}

function CaseStatusBadge({ overview }: { overview: CaseOverview }) {
  return <span className={`case-status ${overview.tone}`}>{overview.statusLabel}</span>;
}

interface CaseOverview {
  readonly tone: "valid" | "changed" | "review" | "invalid";
  readonly statusLabel: string;
  readonly note: string;
  readonly fields: readonly {
    operation: ObservationOperation;
    label: string;
    count: number;
    state: "valid" | "changed" | "review" | "invalid";
    stateLabel: string;
  }[];
}

function summarizeCase(observations: readonly ShadowObservation[]): CaseOverview {
  const invalid = observations.filter((observation) => observation.status === "invalid").length;
  const review = observations.filter((observation) =>
    ["risky", "unknown"].includes(observation.status),
  ).length;
  const changed = observations.filter((observation) => observation.changed).length;
  const applied = observations.filter(
    (observation) => observation.assist_outcome === "applied",
  ).length;
  const kept = observations.filter((observation) => observation.assist_outcome === "kept").length;
  const undone = observations.filter(
    (observation) => observation.assist_outcome === "undone",
  ).length;
  const tone = invalid > 0 ? "invalid" : review > 0 ? "review" : changed > 0 ? "changed" : "valid";
  const statusLabel =
    invalid > 0
      ? t(
          `${numberFormatter.format(invalid)} neplatné`,
          `${numberFormatter.format(invalid)} invalid`,
        )
      : review > 0
        ? t(
            `${numberFormatter.format(review)} k prověření`,
            `${numberFormatter.format(review)} to review`,
          )
        : changed > 0
          ? t(
              `${numberFormatter.format(changed)} návrhů`,
              `${numberFormatter.format(changed)} ${changed === 1 ? "suggestion" : "suggestions"}`,
            )
          : t("V pořádku", "Valid");
  const noteParts = [
    changed > 0
      ? t(
          `${numberFormatter.format(changed)} změn`,
          `${numberFormatter.format(changed)} ${changed === 1 ? "change" : "changes"}`,
        )
      : t("bez návrhu změny", "no suggested change"),
    applied > 0
      ? t(
          `${numberFormatter.format(applied)} použito`,
          `${numberFormatter.format(applied)} applied`,
        )
      : null,
    kept > 0
      ? t(`${numberFormatter.format(kept)} ponecháno`, `${numberFormatter.format(kept)} kept`)
      : null,
    undone > 0
      ? t(`${numberFormatter.format(undone)} vráceno`, `${numberFormatter.format(undone)} undone`)
      : null,
  ].filter(Boolean);
  const groupedFields = new Map<ObservationOperation, ShadowObservation[]>();
  for (const observation of observations) {
    const current = groupedFields.get(observation.operation) ?? [];
    current.push(observation);
    groupedFields.set(observation.operation, current);
  }
  const fields = [...groupedFields.entries()].map(([operation, fieldObservations]) => {
    const field = operationField(operation);
    const fieldInvalid = fieldObservations.some((observation) => observation.status === "invalid");
    const fieldReview = fieldObservations.some((observation) =>
      ["risky", "unknown"].includes(observation.status),
    );
    const fieldChanged = fieldObservations.some((observation) => observation.changed);
    const fieldApplied = fieldObservations.some(
      (observation) => observation.assist_outcome === "applied",
    );
    const state: CaseOverview["fields"][number]["state"] = fieldInvalid
      ? "invalid"
      : fieldReview
        ? "review"
        : fieldChanged
          ? "changed"
          : "valid";
    const stateLabel = fieldInvalid
      ? t("chyba", "error")
      : fieldReview
        ? t("kontrola", "review")
        : fieldChanged
          ? fieldApplied
            ? t("použito", "applied")
            : t("návrh", "suggestion")
          : "ok";
    return {
      operation,
      label: field.label,
      count: fieldObservations.length,
      state,
      stateLabel,
    };
  });
  return { tone, statusLabel, note: noteParts.join(" · "), fields };
}

function customerCaseIdentity(customerCase: ShadowObservationCase): string {
  const candidates = customerCase.observations
    .filter(
      (observation) =>
        ["name.validate", "company_id.validate"].includes(observation.operation) &&
        observation.value_visibility === "full" &&
        /\p{L}/u.test(
          observation.operation === "company_id.validate"
            ? (observation.proposed_value ?? "")
            : observation.input_value,
        ),
    )
    .map((observation) => ({
      value: (observation.operation === "company_id.validate"
        ? (observation.proposed_value ?? "")
        : observation.input_value
      )
        .trim()
        .replace(/\s+/g, " "),
      score:
        (observation.operation === "company_id.validate" ? 8 : 0) +
        (observation.issue_codes.includes("person.company_name_in_contact") ? 5 : 0) +
        (observation.input_value.trim().split(/\s+/).length >= 2 ? 3 : 0) +
        (["valid", "correctable"].includes(observation.status) ? 2 : 0),
    }))
    .filter((candidate) => candidate.value.length > 1 && candidate.value.length <= 160)
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.value ?? t("Zákazník bez jména", "Unnamed customer");
}

function changedFieldLabel(field: string) {
  const labels: Record<string, string> = {
    first_name: t("jméno", "first name"),
    last_name: t("příjmení", "last name"),
    full_name: t("jméno a příjmení", "full name"),
    company_name: t("název firmy", "company name"),
    company_id: "IČO",
    vat_id: "DIČ",
    street_line: t("ulice", "street"),
    city: t("město", "city"),
    postal_code: "PSČ",
    country: t("země", "country"),
  };
  return labels[field] ?? field;
}

function AssistOutcomeBadge({ observation }: { observation: ShadowObservation }) {
  if (observation.assist_outcome === "applied") {
    const label =
      observation.operation === "phone.validate"
        ? t("Automaticky upraveno", "Adjusted automatically")
        : observation.operation === "address.validate"
          ? t("Adresa doplněna", "Address completed")
          : observation.operation === "company_id.validate"
            ? t("Firemní údaje doplněny", "Company details completed")
            : t("Opraveno", "Fixed");
    return <span className="assist-outcome applied">{label}</span>;
  }
  if (observation.assist_outcome === "kept") {
    return <span className="assist-outcome kept">{t("Ponecháno", "Kept")}</span>;
  }
  if (observation.assist_outcome === "undone") {
    return <span className="assist-outcome undone">{t("Vráceno", "Undone")}</span>;
  }
  if (observation.assist_shown_at) {
    return <span className="assist-outcome pending">{t("Bez rozhodnutí", "No decision")}</span>;
  }
  return <span className="assist-outcome none">{t("Nezobrazeno", "Not shown")}</span>;
}

function StatusBadge({ status, changed }: { status: ObservationStatus; changed: boolean }) {
  if (status === "invalid")
    return <span className="monitor-status invalid">{t("Neplatné", "Invalid")}</span>;
  if (changed)
    return <span className="monitor-status changed">{t("Návrh změny", "Suggested change")}</span>;
  if (status === "valid")
    return <span className="monitor-status valid">{t("V pořádku", "Valid")}</span>;
  if (status === "unknown")
    return <span className="monitor-status unknown">{t("Nedostupné", "Unavailable")}</span>;
  return <span className="monitor-status review">{t("K prověření", "To review")}</span>;
}

function issueLabel(code: string) {
  const labels: Record<string, string> = {
    "person.full_name_missing": t("Chybí jméno a příjmení", "Missing first and last name"),
    "person.full_name_incomplete": t(
      "Jméno nebo příjmení není úplné",
      "First or last name is incomplete",
    ),
    "person.company_name_in_contact": t(
      "V osobním poli je název firmy",
      "Company name in a personal field",
    ),
    "person.whitespace_normalized": t("Odstraněny přebytečné mezery", "Extra spaces removed"),
    "person.trailing_punctuation": t("Odstraněna koncová čárka", "Trailing comma removed"),
    "person.title_normalized": t(
      "Opraven zápis nebo mezera u titulu",
      "Title spelling or spacing fixed",
    ),
    "person.capitalization_normalized": t(
      "Opravena velikost písmen ve jménu",
      "Name capitalisation fixed",
    ),
    "person.initial_spacing_normalized": t(
      "Doplněna mezera za iniciálou",
      "Space added after an initial",
    ),
    "person.capitalization_ambiguous": t(
      "Neobvyklá velikost písmen vyžaduje kontrolu",
      "Unusual capitalisation needs review",
    ),
    "person.invalid_characters": t(
      "Jméno obsahuje číslice nebo nepovolené znaky",
      "Name contains digits or disallowed characters",
    ),
    "person.separator_invalid": t(
      "Jméno obsahuje chybně zapsanou pomlčku nebo apostrof",
      "Name contains a malformed hyphen or apostrophe",
    ),
    "email.syntax_invalid": t("Neplatný formát e-mailu", "Invalid email format"),
    "email.domain_invalid": t("Neplatná doména", "Invalid domain"),
    "email.domain_typo": t("Pravděpodobný překlep v doméně", "Likely typo in the domain"),
    "email.domain_no_dns": t("Doména nemá DNS záznam", "Domain has no DNS record"),
    "email.domain_no_mx": t("Doména nemá MX záznam", "Domain has no MX record"),
    "email.domain_disposable": t("Dočasná e-mailová doména", "Disposable email domain"),
    "email.local_role": t("Sdílená role místo osoby", "Shared role instead of a person"),
    "phone.normalized": t("Sjednocený formát telefonu", "Phone format unified"),
    "phone.number_impossible": t("Nemožné telefonní číslo", "Impossible phone number"),
    "phone.country_not_cz": t("Telefon není český", "Phone number is not Czech"),
    "phone.number_unassigned_or_invalid": t(
      "Neplatný nebo nepřidělený telefon",
      "Invalid or unassigned phone number",
    ),
    "address.ruian_normalized": t(
      "Ověřený standardní zápis adresy",
      "Verified standard address form",
    ),
    "address.ruian_ambiguous": t(
      "RÚIAN našel více možných adres",
      "RÚIAN found several possible addresses",
    ),
    "address.ruian_low_confidence": t(
      "Shoda adresy není dostatečně jistá",
      "Address match is not certain enough",
    ),
    "address.ruian_not_found": t("Adresa nebyla nalezena v RÚIAN", "Address not found in RÚIAN"),
    "address.ruian_unavailable": t(
      "RÚIAN je dočasně nedostupný",
      "RÚIAN is temporarily unavailable",
    ),
    "address.autocomplete_suggestion": t("Návrh adresy z RÚIAN", "Address suggestion from RÚIAN"),
    "address.autocomplete_no_match": t(
      "Adresa nebyla nalezena v RÚIAN",
      "Address not found in RÚIAN",
    ),
    "address.country_mismatch": t(
      "Adresa neodpovídá zvolené zemi Česko",
      "Address does not match the selected country (Czechia)",
    ),
    "person.first_name_missing": t("Chybí jméno příjemce", "Recipient's first name is missing"),
    "person.last_name_missing": t("Chybí příjmení příjemce", "Recipient's last name is missing"),
    "company.ico_normalized": t("IČO ověřeno a sjednoceno", "IČO verified and unified"),
    "company.ico_format_invalid": t("Neplatný formát IČO", "Invalid IČO format"),
    "company.ico_checksum_invalid": t("Neplatný kontrolní součet IČO", "Invalid IČO checksum"),
    "company.ares_not_found": t("IČO nebylo nalezeno v ARES", "IČO not found in ARES"),
    "company.ares_unavailable": t("ARES je dočasně nedostupný", "ARES is temporarily unavailable"),
    "company.ares_invalid_response": t(
      "ARES vrátil neplatnou odpověď",
      "ARES returned an invalid response",
    ),
  };
  return labels[code] ?? code;
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    syntax: t("Syntaxe", "Syntax"),
    dns: "DNS",
    domain_metadata: t("Doménová pravidla", "Domain rules"),
    local_part: t("Lokální část", "Local part"),
    libphonenumber: t("Telefonní plán", "Numbering plan"),
    ruian: "RÚIAN",
    ares: "ARES",
    country: t("Země objednávky", "Order country"),
  };
  return labels[source] ?? source;
}

function operationField(operation: ShadowObservation["operation"]): {
  label: string;
  tone: string;
} {
  if (operation === "name.validate") return { label: t("Jméno", "Name"), tone: "name" };
  if (operation === "email.validate") return { label: t("E-mail", "Email"), tone: "email" };
  if (operation === "phone.validate") return { label: t("Telefon", "Phone"), tone: "phone" };
  if (operation === "address.validate") return { label: t("Adresa", "Address"), tone: "address" };
  return { label: "IČO", tone: "company" };
}

async function fetchShadowObservations(
  page: number,
  query: MonitorQuery,
  signal: AbortSignal,
): Promise<ShadowObservationList> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: "25",
    filter: query.filter,
    from: new Date(Date.now() - periodDurationMs(query.period)).toISOString(),
  });
  if (query.operation !== "all") params.set("operation", query.operation);
  if (query.resultClass !== "all") params.set("result", query.resultClass);
  if (query.assistOutcome !== "all") params.set("assist_outcome", query.assistOutcome);
  if (query.clientName !== "all") params.set("client_name", query.clientName);
  if (query.formId) params.set("form_id", query.formId);
  if (query.checkoutOutcome !== "all") params.set("checkout_outcome", query.checkoutOutcome);

  const searchActive = query.search.length >= 2;
  const endpoint = searchActive
    ? "/checkdrop/v1/operator/observations/search"
    : "/checkdrop/v1/operator/observations";
  const response = await fetch(`${endpoint}?${params.toString()}`, {
    method: searchActive ? "POST" : "GET",
    headers: {
      ...localeHeader,
      Accept: "application/json",
      ...(searchActive ? { "Content-Type": "application/json" } : {}),
    },
    ...(searchActive ? { body: JSON.stringify({ query: query.search }) } : {}),
    signal,
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: unknown) =>
        body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
          ? body.detail
          : null,
      )
      .catch(() => null);
    throw new Error(
      detail ??
        t(
          `Server vrátil stav ${response.status}.`,
          `The server returned status ${response.status}.`,
        ),
    );
  }
  const payload = (await response.json()) as ShadowObservationList;
  if (
    payload.object !== "shadow_observation_list" ||
    !Array.isArray(payload.data) ||
    !payload.summary ||
    !payload.pagination
  ) {
    throw new Error(
      t("Server vrátil neplatná data monitoru.", "The server returned invalid monitor data."),
    );
  }
  return payload;
}

function isClientName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(value) && /[A-Za-z]/.test(value);
}

/** Connected websites for the filter: saved integrations first, then any client seen only in data. */
function monitorSiteOptions(
  sites: readonly MonitorSite[],
  observations: readonly ShadowObservation[],
): readonly (readonly [string, string])[] {
  const options = new Map<string, string>();
  for (const site of [...sites].sort((left, right) =>
    left.name.localeCompare(right.name, intlLocale),
  ))
    options.set(site.client_name, site.name);
  for (const observation of observations)
    if (!options.has(observation.client_name))
      options.set(observation.client_name, observation.client_name);
  return [...options.entries()];
}

function periodDurationMs(period: PeriodFilter): number {
  const days = period === "24h" ? 1 : Number.parseInt(period, 10);
  return days * 24 * 60 * 60 * 1_000;
}
