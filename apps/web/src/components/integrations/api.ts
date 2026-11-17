import { localeHeader, t } from "../../i18n";

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/checkdrop/v1/operator${path}`, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
    headers: {
      ...localeHeader,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
  if (!response.ok)
    throw new Error(
      payload?.detail ??
        t(`Požadavek selhal (${response.status}).`, `Request failed (${response.status}).`),
    );
  assertOperatorPayload(path, payload);
  return payload as T;
}

export function messageFrom(value: unknown) {
  return value instanceof Error
    ? value.message
    : t("Operaci se nepodařilo dokončit.", "The operation could not be completed.");
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fields(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (field) =>
        object(field) &&
        typeof field.selector === "string" &&
        typeof field.label === "string" &&
        typeof field.canonical_field === "string" &&
        ["off", "shadow", "suggest"].includes(String(field.validation_mode)) &&
        ["input", "blur", "submit"].includes(String(field.validation_trigger)),
    )
  );
}
function integration(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.form_url === "string" &&
    /^https?:\/\//.test(value.form_url) &&
    Number.isSafeInteger(value.config_version) &&
    fields(value.fields) &&
    Array.isArray(value.api_keys) &&
    Array.isArray(value.forms) &&
    value.forms.every(
      (form) =>
        object(form) &&
        typeof form.id === "string" &&
        typeof form.name === "string" &&
        typeof form.root_selector === "string" &&
        Number.isSafeInteger(form.config_version) &&
        fields(form.fields),
    )
  );
}
export function assertOperatorPayload(path: string, payload: unknown): void {
  let valid = false;
  if (path.endsWith("/versions"))
    valid =
      object(payload) &&
      Array.isArray(payload.data) &&
      payload.data.every((version) => object(version) && Number.isSafeInteger(version.version));
  else if (path.endsWith("/scan"))
    valid = object(payload) && Array.isArray(payload.fields) && object(payload.drift);
  else if (path === "/instance")
    valid =
      object(payload) &&
      payload.object === "instance" &&
      typeof payload.version === "string" &&
      object(payload.address_data);
  else if (path === "/integrations" && object(payload) && Array.isArray(payload.data))
    valid = payload.data.every(integration);
  else valid = integration(payload);
  if (!valid)
    throw new Error(
      t(
        "Server vrátil neplatnou konfiguraci. Obnovte načtení; rozpracované změny zůstávají zachované.",
        "The server returned an invalid configuration. Reload; your unsaved changes are kept.",
      ),
    );
}
