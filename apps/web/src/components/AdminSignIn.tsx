import { type FormEvent, useEffect, useState } from "react";
import { locale, setLocale, t } from "../i18n";
import { safeNext } from "./sign-in-next";

type Status = {
  readonly mode: "password";
  readonly setup_required: boolean;
  readonly setup_available: boolean;
  readonly signed_in: boolean;
};

const errors: Record<string, string> = {
  invalid_credentials: t("E-mail nebo heslo nesedí.", "The e-mail or password is wrong."),
  too_many_attempts: t(
    "Příliš mnoho pokusů. Zkuste to znovu za minutu.",
    "Too many attempts. Try again in a minute.",
  ),
  invalid_setup_code: t(
    "Instalační kód nesedí. Na serveru ho vypíše ./checkdrop setup-code.",
    "The setup code is wrong. On the server, ./checkdrop setup-code prints it.",
  ),
  invalid_email: t("Zadejte platný e-mail.", "Enter a valid e-mail."),
  password_too_short: t(
    "Heslo musí mít aspoň 12 znaků.",
    "The password needs at least 12 characters.",
  ),
  password_too_long: t("Heslo je příliš dlouhé.", "The password is too long."),
  already_set_up: t(
    "Účet správce už existuje. Přihlaste se.",
    "An administrator account exists. Sign in.",
  ),
  setup_disabled: t(
    "Instalační kód není nastavený. Spusťte instalaci znovu.",
    "No setup code is configured. Run the installation again.",
  ),
};

export default function AdminSignIn() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState(t("Načítám…", "Loading…"));
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");

  useEffect(() => {
    document.title = `${t("Přihlášení", "Sign in")} | Checkdrop`;
    void fetch("/v1/admin/auth/status", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const value = (await response.json()) as Status;
        if (value.signed_in) {
          window.location.replace(safeNext(window.location.search, window.location.origin));
          return;
        }
        setStatus(value);
        setMessage("");
      })
      .catch(() =>
        setMessage(
          t(
            "Přihlášení teď neodpovídá. Obnovte stránku.",
            "Sign-in is not responding. Reload the page.",
          ),
        ),
      );
  }, []);

  const setup = status?.setup_required === true;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !status) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(setup ? "/v1/admin/auth/setup" : "/v1/admin/auth/sign-in", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          setup ? { setup_code: setupCode, email, password } : { email, password },
        ),
      });
      if (response.ok) {
        window.location.replace(safeNext(window.location.search, window.location.origin));
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(
        errors[body.error ?? ""] ??
          t("Přihlášení se nepodařilo. Zkuste to znovu.", "Sign-in failed. Try again."),
      );
      if (body.error === "already_set_up") setStatus({ ...status, setup_required: false });
    } catch {
      setMessage(
        t(
          "Přihlášení se nepodařilo. Zkontrolujte připojení.",
          "Sign-in failed. Check your connection.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="customer-login">
      <div className="sign-in-top">
        <span className="customer-login-brand">Checkdrop</span>
        <button
          type="button"
          className="sign-in-language"
          onClick={() => setLocale(locale === "cs" ? "en" : "cs")}
          lang={locale === "cs" ? "en" : "cs"}
        >
          {locale === "cs" ? "English" : "Čeština"}
        </button>
      </div>
      <h1>
        {setup
          ? t("Založení účtu správce", "Create the administrator account")
          : t("Přihlášení", "Sign in")}
      </h1>
      <p>
        {setup ? (
          <>
            {t(
              "První spuštění. Instalační kód vypsala instalace na svém konci a platí jen pro založení prvního účtu. Pokud ho nemáte, vypíše ho na serveru příkaz ",
              "First start. The installation printed the setup code at its end; it only works for creating the first account. If you do not have it, this command on the server prints it: ",
            )}
            <code>./checkdrop setup-code</code>.
          </>
        ) : (
          t("Přihlaste se do administrace Checkdropu.", "Sign in to the Checkdrop administration.")
        )}
      </p>
      {status && (
        <form onSubmit={submit} aria-busy={busy}>
          {setup && (
            <>
              <label htmlFor="setup-code">{t("Instalační kód", "Setup code")}</label>
              <input
                id="setup-code"
                autoComplete="one-time-code"
                spellCheck={false}
                required
                value={setupCode}
                onChange={(event) => setSetupCode(event.target.value)}
                disabled={busy}
              />
            </>
          )}
          <label htmlFor="sign-in-email">E-mail</label>
          <input
            id="sign-in-email"
            type="email"
            autoComplete={setup ? "email" : "username"}
            maxLength={320}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
          <label htmlFor="sign-in-password">{t("Heslo", "Password")}</label>
          <input
            id="sign-in-password"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            minLength={setup ? 12 : undefined}
            maxLength={256}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            aria-describedby={setup ? "password-help" : undefined}
          />
          <p className="customer-login-help" id="password-help">
            {setup
              ? t(
                  "Aspoň 12 znaků. Heslo uložíme jen jako bezpečný otisk.",
                  "At least 12 characters. Only a secure hash of the password is stored.",
                )
              : " "}
          </p>
          <button type="submit" disabled={busy}>
            {busy
              ? t("Přihlašuji…", "Signing in…")
              : setup
                ? t("Založit účet a přihlásit", "Create account and sign in")
                : t("Přihlásit", "Sign in")}
          </button>
        </form>
      )}
      <p className="customer-login-status" role="status" aria-live="polite">
        {message}
      </p>
      {status && !setup && (
        <p className="customer-login-help">
          {t(
            "Zapomenuté heslo obnovíte na serveru příkazem",
            "Reset a forgotten password on the server with",
          )}{" "}
          <code>./checkdrop reset-password</code>.
        </p>
      )}
    </main>
  );
}
