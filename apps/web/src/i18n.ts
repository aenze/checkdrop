/**
 * Interface language of the administration: Czech or English. Each text is written inline as a
 * Czech and English pair, so a screen stays readable in either language without a key catalogue.
 * The choice is stored in this browser; without one, Czech and Slovak browsers get Czech.
 */
export type Locale = "cs" | "en";

const STORAGE_KEY = "checkdrop.locale";

export function detectLocale(stored: string | null, languages: readonly string[]): Locale {
  if (stored === "cs" || stored === "en") return stored;
  return languages.some((language) => /^(cs|sk)\b/i.test(language)) ? "cs" : "en";
}

function browserLocale(): Locale {
  if (typeof window === "undefined") return "cs";
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage may be blocked; the browser language still decides.
  }
  return detectLocale(
    stored,
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
}

export const locale: Locale = browserLocale();
if (typeof document !== "undefined") document.documentElement.lang = locale;

/** Czech first, English second. */
export function t(cs: string, en: string): string {
  return locale === "en" ? en : cs;
}

/** Locale for Intl number and date formatting. */
export const intlLocale = locale === "en" ? "en-GB" : "cs-CZ";

export function setLocale(next: Locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Without storage the choice lasts until the page is reloaded.
  }
  window.location.reload();
}

/** Sent with every administration request so server messages come back in the same language. */
export const localeHeader = { "X-Checkdrop-Locale": locale } as const;
