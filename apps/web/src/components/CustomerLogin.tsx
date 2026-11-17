import { type FormEvent, useEffect, useState } from "react";

export default function CustomerLogin() {
  const [email, setEmail] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ověřuji dostupnost přihlášení…");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    void fetch("/customer/auth/status", {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const status = await response.json();
        if (status.email_login_enabled !== true) throw new Error("unavailable");
        setReady(true);
        setMessage("");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage("Zákaznické přihlášení zatím není dostupné. Zkuste to později.");
        else setMessage("Přihlášení neodpovídá. Obnovte stránku a zkuste to znovu.");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/customer/auth/request", {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429) {
        setMessage("Příliš mnoho pokusů. Chvíli počkejte a zkuste to znovu.");
        return;
      }
      if (response.status !== 202 || (await response.json()).status !== "accepted")
        throw new Error("unavailable");
      setMessage(
        "Pokud k tomuto e-mailu máte přístup do Checkdropu, přijde vám přihlašovací odkaz. Zkontrolujte i nevyžádanou poštu.",
      );
    } catch {
      setMessage("Žádost se nepodařilo dokončit. Zkuste to prosím později.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="customer-login">
      <a className="customer-login-brand" href="/">
        Checkdrop
      </a>
      <h1>Přihlášení</h1>
      <p>Zadejte svůj e-mail. Pošleme vám jednorázový odkaz, heslo nepotřebujete.</p>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor="login-email">E-mail</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={320}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={!ready || busy}
          aria-describedby="login-help"
        />
        <p className="customer-login-help" id="login-help">
          Odkaz platí 15 minut. Otevřete ho ve stejném prohlížeči.
        </p>
        <button type="submit" disabled={!ready || busy}>
          {busy ? "Odesílám žádost…" : "Poslat přihlašovací odkaz"}
        </button>
      </form>
      <p className="customer-login-status" role="status" aria-live="polite">
        {message}
      </p>
      <a className="customer-login-support" href="mailto:support@checkdrop.dev">
        Potřebujete pomoc?
      </a>
    </main>
  );
}
