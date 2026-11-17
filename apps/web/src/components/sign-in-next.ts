const ADMIN_PAGES = /^\/(dashboard|monitor|integrations|playground)(\/|$)/;

/**
 * Where to go after signing in: only an administration page of this origin. Browsers turn paths
 * such as "/\\evil.example" or "/\t/evil.example" into other hosts, so the target is parsed and
 * compared, not checked as text.
 */
export function safeNext(search: string, origin: string): string {
  const raw = new URLSearchParams(search).get("next");
  if (!raw) return "/dashboard";
  try {
    const url = new URL(raw, origin);
    if (url.origin === origin && ADMIN_PAGES.test(url.pathname)) return url.pathname + url.search;
  } catch {
    // Not a URL at all.
  }
  return "/dashboard";
}
