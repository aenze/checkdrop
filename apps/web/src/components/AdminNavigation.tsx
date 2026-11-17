import {
  CheckSquareIcon as CheckSquare,
  LinkSimpleIcon as LinkSimple,
  PulseIcon as Pulse,
  SignOutIcon as SignOut,
  SquaresFourIcon as SquaresFour,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { locale, setLocale, t } from "../i18n";

/** Shown only where Checkdrop's own sign-in protects the administration. */
function useSignedInEmail() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/v1/admin/auth/status", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((status) => setEmail(status?.signed_in ? (status.email ?? "") : null))
      .catch(() => setEmail(null));
  }, []);
  return email;
}

async function signOut() {
  await fetch("/v1/admin/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
  window.location.replace("/sign-in");
}

export default function AdminNavigation({
  active,
}: {
  readonly active: "integrations" | "monitor" | "playground" | "dashboard";
}) {
  const email = useSignedInEmail();
  useEffect(() => {
    const titles = {
      dashboard: t("Přehled", "Overview"),
      monitor: "Monitor",
      integrations: t("Napojení e-shopu", "Shop connections"),
      playground: t("Ověření", "Checks"),
    } as const;
    document.title = `${titles[active]} | Checkdrop`;
  }, [active]);
  return (
    <nav className="integration-rail" aria-label={t("Hlavní navigace", "Main navigation")}>
      <a
        href="/dashboard"
        className={active === "dashboard" ? "active" : undefined}
        aria-current={active === "dashboard" ? "page" : undefined}
      >
        <SquaresFour size={22} />
        <span>{t("Přehled", "Overview")}</span>
      </a>
      <a
        className={active === "monitor" ? "active" : undefined}
        aria-current={active === "monitor" ? "page" : undefined}
        href="/monitor"
        title="Monitor"
        aria-label="Monitor"
      >
        <Pulse size={22} />
        <span>Monitor</span>
      </a>
      <a
        className={active === "integrations" ? "active" : undefined}
        href="/integrations"
        title={t("Napojení", "Connections")}
        aria-label={t("Napojení", "Connections")}
        aria-current={active === "integrations" ? "page" : undefined}
      >
        <LinkSimple size={22} />
        <span>{t("Napojení", "Connections")}</span>
      </a>
      <a
        href="/playground"
        title={t("Ověření", "Checks")}
        aria-label={t("Ověření", "Checks")}
        className={active === "playground" ? "active" : undefined}
        aria-current={active === "playground" ? "page" : undefined}
      >
        <CheckSquare size={22} />
        <span>{t("Ověření", "Checks")}</span>
      </a>
      <span className="rail-spacer" />
      <button
        type="button"
        className="rail-sign-out rail-language"
        onClick={() => setLocale(locale === "cs" ? "en" : "cs")}
        title={t("Switch to English", "Přepnout do češtiny")}
        aria-label={t("Switch to English", "Přepnout do češtiny")}
        lang={locale === "cs" ? "en" : "cs"}
      >
        <span className="rail-language-code">{locale === "cs" ? "EN" : "CS"}</span>
        <span>{locale === "cs" ? "English" : "Čeština"}</span>
      </button>
      {email !== null && (
        <button
          type="button"
          className="rail-sign-out"
          onClick={() => void signOut()}
          title={email ? t(`Odhlásit ${email}`, `Sign out ${email}`) : t("Odhlásit", "Sign out")}
          aria-label={t("Odhlásit", "Sign out")}
        >
          <SignOut size={20} />
          <span>{t("Odhlásit", "Sign out")}</span>
        </button>
      )}
    </nav>
  );
}
