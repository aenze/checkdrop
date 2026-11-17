/**
 * Addresses and modes of one Checkdrop installation. Every value has a default that keeps the
 * hosted service at checkdrop.dev unchanged; a self-hosted installation sets its own addresses so
 * no generated snippet or link points to someone else's server.
 */

/** Stable identifiers, not addresses that are ever fetched. */
export const PROJECT_URL = "https://checkdrop.dev";
export const PROBLEM_TYPE_BASE = `${PROJECT_URL}/problems`;

const HOSTED_API_URL = "https://api.checkdrop.dev";
const HOSTED_ADMIN_URL = "https://app.checkdrop.dev";

export type AdminAuthMode = "external" | "password";

export interface InstanceConfig {
  /** Origin that serves /v1/embed.js and the validation API to shoppers' browsers. */
  readonly publicApiUrl: string;
  /** Origin of the protected administration. */
  readonly publicAdminUrl: string;
  /**
   * "password": Checkdrop's own administrator accounts and sessions (default everywhere).
   * "external": only for an installation where an access proxy already authenticates operators
   * and that has not moved to accounts yet.
   */
  readonly adminAuthMode: AdminAuthMode;
}

export function readInstanceConfig(env: NodeJS.ProcessEnv = process.env): InstanceConfig {
  const publicApiUrl = publicOrigin(env.CHECKDROP_PUBLIC_API_URL, HOSTED_API_URL, "API");
  const publicAdminUrl = publicOrigin(
    env.CHECKDROP_PUBLIC_ADMIN_URL,
    env.CHECKDROP_PUBLIC_API_URL ? publicApiUrl : HOSTED_ADMIN_URL,
    "admin",
  );
  // Secure by default: an installation that forgets this setting still requires a sign-in.
  const mode = env.CHECKDROP_ADMIN_AUTH?.trim() || "password";
  if (mode !== "external" && mode !== "password") {
    throw new Error("CHECKDROP_ADMIN_AUTH must be external or password.");
  }
  return { publicApiUrl, publicAdminUrl, adminAuthMode: mode };
}

/** An HTTPS origin, or plain HTTP only for a local test installation. */
export function publicOrigin(value: string | undefined, fallback: string, label: string): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`The public ${label} URL is not a valid URL.`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`The public ${label} URL must use HTTPS (plain HTTP only for localhost).`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(
      `The public ${label} URL must be an origin such as https://checks.example.com.`,
    );
  }
  return url.origin;
}

export function embedSnippet(apiUrl: string, siteKey: string): string {
  return `<script async src="${apiUrl}/v1/embed.js" data-checkdrop-site="${siteKey}"></script>`;
}
