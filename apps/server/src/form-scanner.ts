import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type {
  CanonicalFormField,
  FieldValidationMode,
  FieldValidationTrigger,
  FormFieldContext,
} from "@checkdrop/db";
import { type DefaultTreeAdapterTypes, parse } from "parse5";
import type { Locale } from "./i18n.js";
import { PROJECT_URL } from "./instance-config.js";

const MAX_FORM_HTML_BYTES = 2 * 1_024 * 1_024;
const MAX_REDIRECTS = 3;
const SCAN_TIMEOUT_MS = 5_000;

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

export interface DetectedFormField {
  readonly selector: string;
  readonly rootSelector?: string;
  readonly label: string;
  readonly name: string | null;
  readonly inputType: string;
  readonly canonicalField: CanonicalFormField;
  readonly context: FormFieldContext;
  readonly required: boolean;
  readonly validationMode: FieldValidationMode;
  readonly validationTrigger: FieldValidationTrigger;
  readonly confidence: number;
  readonly autocomplete: string | null;
}

export interface FormScanResult {
  readonly sanitizedUrl: string;
  readonly pageTitle: string | null;
  readonly formCount: number;
  readonly fields: readonly DetectedFormField[];
}

export type FormScanErrorCode =
  | "invalid_url"
  | "private_target"
  | "fetch_failed"
  | "not_html"
  | "body_too_large"
  | "no_form_fields";

/** Thrown outside a request, so it carries both texts; the route picks one with msg(). */
export class FormScanError extends Error {
  readonly code: FormScanErrorCode;
  /** Czech text, also kept as `message`. */
  readonly cs: string;
  readonly en: string;

  constructor(code: FormScanErrorCode, cs: string, en: string) {
    super(cs);
    this.name = "FormScanError";
    this.code = code;
    this.cs = cs;
    this.en = en;
  }
}

export interface FormScannerOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly resolveHostname?: (
    hostname: string,
  ) => Promise<readonly { readonly address: string; readonly family: number }[]>;
  readonly timeoutMs?: number;
  /** Language of generated text such as the label of an unnamed field. */
  readonly locale?: Locale;
}

export function sanitizeFormUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FormScanError(
      "invalid_url",
      "Zadejte úplnou HTTPS adresu formuláře.",
      "Enter the full HTTPS address of the form.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname ||
    url.hostname.endsWith(".local") ||
    url.hostname.toLowerCase() === "localhost" ||
    isIP(url.hostname) !== 0
  ) {
    throw new FormScanError(
      "invalid_url",
      "Formulář musí být na veřejné HTTPS doméně.",
      "The form must be on a public HTTPS domain.",
    );
  }
  url.hash = "";
  return url;
}

export async function scanFormUrl(
  input: string,
  options: FormScannerOptions = {},
): Promise<FormScanResult> {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const resolveHostname =
    options.resolveHostname ??
    (async (hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  const timeoutMs = options.timeoutMs ?? SCAN_TIMEOUT_MS;
  let url = sanitizeFormUrl(input);
  let response: Response | null = null;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHostname(url.hostname, resolveHostname, timeoutMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchRequest(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": `Checkdrop-Form-Scanner/0.1 (+${PROJECT_URL})`,
        },
        signal: controller.signal,
      });
    } catch {
      throw new FormScanError(
        "fetch_failed",
        "Stránku formuláře se nepodařilo bezpečně načíst.",
        "The form page could not be loaded safely.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location || redirect === MAX_REDIRECTS) {
        throw new FormScanError(
          "fetch_failed",
          "Stránka obsahuje příliš mnoho přesměrování.",
          "The page has too many redirects.",
        );
      }
      url = sanitizeFormUrl(new URL(location, url).toString());
      continue;
    }
    break;
  }

  if (!response?.ok) {
    throw new FormScanError(
      "fetch_failed",
      "Stránka formuláře nevrátila úspěšnou odpověď.",
      "The form page did not return a successful response.",
    );
  }
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new FormScanError(
      "not_html",
      "Zadaná URL nevrací HTML stránku.",
      "The URL does not return an HTML page.",
    );
  }
  const html = await readBoundedText(response, MAX_FORM_HTML_BYTES, timeoutMs);
  const result = detectFormFields(html, url, options.locale);
  if (result.fields.length === 0) {
    throw new FormScanError(
      "no_form_fields",
      "Na stránce nebyla nalezena formulářová pole. Použijte mapovací režim pro dynamický formulář.",
      "No form fields were found on the page. Use mapping mode for a dynamic form.",
    );
  }
  return result;
}

export function detectFormFields(
  html: string,
  sourceUrl: URL,
  locale: Locale = "cs",
): FormScanResult {
  const document = parse(html);
  const elements = collectElements(document);
  const labels = collectLabels(elements);
  const forms = elements.filter((element) => element.tagName === "form");
  const seenRadioNames = new Set<string>();
  const fields: DetectedFormField[] = [];

  for (const element of elements) {
    if (!isSupportedControl(element)) continue;
    const type = attribute(element, "type")?.toLowerCase() ?? defaultInputType(element);
    if (["hidden", "password", "file", "submit", "button", "reset", "image"].includes(type)) {
      continue;
    }
    const name = attribute(element, "name");
    if ((type === "radio" || type === "checkbox") && name) {
      if (seenRadioNames.has(name)) continue;
      seenRadioNames.add(name);
    }
    const autocomplete = attribute(element, "autocomplete")?.toLowerCase() ?? null;
    const label = fieldLabel(element, labels, elements, locale);
    const contextText = normalizeDetectionText(`${label} ${ancestorContext(element)}`);
    const detected = classifyField({ element, label, name, type, autocomplete, contextText });
    fields.push({
      selector: stableSelector(element),
      rootSelector: rootSelectorFor(element),
      label,
      name,
      inputType: type,
      canonicalField: detected.field,
      context: detected.context,
      required: hasAttribute(element, "required") || attribute(element, "aria-required") === "true",
      validationMode: detected.field === "unmapped" ? "off" : "shadow",
      validationTrigger: [
        "customer_type",
        "profile_details_enabled",
        "alternate_shipping_enabled",
        "company_name",
        "company_id",
        "street_line",
      ].includes(detected.field)
        ? "input"
        : "blur",
      confidence: detected.confidence,
      autocomplete,
    });
  }

  return {
    sanitizedUrl: sanitizedUrlForStorage(sourceUrl),
    pageTitle: textContent(elements.find((element) => element.tagName === "title") ?? null) || null,
    formCount: forms.length,
    fields,
  };
}

async function assertPublicHostname(
  hostname: string,
  resolveHostname: (
    hostname: string,
  ) => Promise<readonly { readonly address: string; readonly family: number }[]>,
  timeoutMs: number,
) {
  let addresses: readonly { readonly address: string; readonly family: number }[];
  try {
    addresses = await withDeadline(resolveHostname(hostname), timeoutMs);
  } catch {
    throw new FormScanError(
      "fetch_failed",
      "Doménu formuláře se nepodařilo přeložit.",
      "The form domain could not be resolved.",
    );
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new FormScanError(
      "private_target",
      "URL formuláře nesmí směřovat do privátní sítě.",
      "The form URL must not point to a private network.",
    );
  }
}

async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isPublicAddress(address: string): boolean {
  if (address.includes(":")) {
    const value = address.toLowerCase();
    if (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      /^fe[89ab]/.test(value) ||
      value.startsWith("ff") ||
      value.startsWith("2001:db8:")
    ) {
      return false;
    }
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value)?.[1];
    return mapped ? isPublicAddress(mapped) : true;
  }
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new FormScanError(
      "body_too_large",
      "HTML stránky překračuje bezpečný limit 2 MiB.",
      "The page HTML exceeds the safe limit of 2 MiB.",
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, timeoutMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new FormScanError(
          "body_too_large",
          "HTML stránky překračuje bezpečný limit 2 MiB.",
          "The page HTML exceeds the safe limit of 2 MiB.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (!timedOut) throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (timedOut) {
    throw new FormScanError(
      "fetch_failed",
      "Načítání formuláře překročilo časový limit.",
      "Loading the form timed out.",
    );
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function collectElements(root: HtmlNode): HtmlElement[] {
  const output: HtmlElement[] = [];
  const visit = (node: HtmlNode) => {
    if ("tagName" in node) output.push(node as HtmlElement);
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return output;
}

function collectLabels(elements: readonly HtmlElement[]): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const element of elements) {
    if (element.tagName !== "label") continue;
    const target = attribute(element, "for");
    if (target) labels.set(target, textContent(element));
  }
  return labels;
}

function isSupportedControl(element: HtmlElement) {
  return ["input", "select", "textarea"].includes(element.tagName);
}

function defaultInputType(element: HtmlElement) {
  return element.tagName === "select"
    ? "select"
    : element.tagName === "textarea"
      ? "textarea"
      : "text";
}

function fieldLabel(
  element: HtmlElement,
  labels: ReadonlyMap<string, string>,
  elements: readonly HtmlElement[],
  locale: Locale,
) {
  const id = attribute(element, "id");
  const explicit = id ? labels.get(id) : null;
  const wrapping = closestAncestor(element, "label");
  const labelledBy = attribute(element, "aria-labelledby")
    ?.split(/\s+/)
    .map((target) =>
      textContent(elements.find((candidate) => attribute(candidate, "id") === target) ?? null),
    )
    .filter(Boolean)
    .join(" ");
  return compactText(
    explicit ||
      labelledBy ||
      attribute(element, "aria-label") ||
      (wrapping ? textContent(wrapping) : "") ||
      attribute(element, "placeholder") ||
      attribute(element, "name") ||
      attribute(element, "id") ||
      (locale === "en" ? "Unnamed field" : "Nepojmenované pole"),
  );
}

function classifyField(input: {
  readonly element: HtmlElement;
  readonly label: string;
  readonly name: string | null;
  readonly type: string;
  readonly autocomplete: string | null;
  readonly contextText: string;
}): { field: CanonicalFormField; context: FormFieldContext; confidence: number } {
  const haystack = normalizeDetectionText(
    `${input.label} ${input.name ?? ""} ${attribute(input.element, "id") ?? ""} ${input.autocomplete ?? ""}`,
  );
  const context: FormFieldContext = /doruc|delivery|shipping/.test(input.contextText)
    ? "shipping"
    : /ico|company|firma|firmn/.test(haystack)
      ? "company"
      : /email|telefon|phone|tel\b/.test(haystack)
        ? "shared"
        : "billing";
  const match = (pattern: RegExp, field: CanonicalFormField, confidence = 92) =>
    pattern.test(haystack) ? { field, context, confidence } : null;

  return (
    (input.type === "email"
      ? { field: "email" as const, context: "shared" as const, confidence: 99 }
      : null) ??
    (input.type === "tel"
      ? { field: "phone" as const, context: "shared" as const, confidence: 99 }
      : null) ??
    match(/customer[_ -]?type|nakupuji|soukrom|na firmu|business[_ -]?type/, "customer_type") ??
    match(
      /chci vyplnit vsechny udaje|vyplnit vsechny udaje|profile[_ -]?details|extended[_ -]?details/,
      "profile_details_enabled",
      96,
    ) ??
    match(
      /dorucit na jinou adresu|jina dorucovaci adresa|alternate[_ -]?shipping|different[_ -]?shipping/,
      "alternate_shipping_enabled",
      96,
    ) ??
    match(
      /full name|name and surname|jmeno a prijmeni|kontaktni osoba|contact name/,
      "full_name",
    ) ??
    match(/first[_ -]?name|given[_ -]?name|krestni jmeno|jmeno$/, "first_name") ??
    match(/last[_ -]?name|family[_ -]?name|surname|prijmeni/, "last_name") ??
    match(/e-?mail|email/, "email") ??
    match(/telefon|phone|tel cislo|mobile/, "phone") ??
    match(/street-address|address-line1|ulice|street|adresa/, "street_line") ??
    match(/address-level2|mesto|obec|city|town/, "city") ??
    match(/postal-code|psc|zip|post code/, "postal_code") ??
    match(/country-name|zeme|stat|country/, "country") ??
    match(/\bdic\b|vat[_ -]?id|vat number|danove identifikacni cislo/, "vat_id") ??
    match(/\bico\b|company id|company number/, "company_id") ?? {
      field: /company[_ -]?name|nazev firmy|firma|obchodni jmeno/.test(haystack)
        ? "company_name"
        : "unmapped",
      context: /company[_ -]?name|nazev firmy|firma|obchodni jmeno/.test(haystack)
        ? "company"
        : context,
      confidence: /company[_ -]?name|nazev firmy|firma|obchodni jmeno/.test(haystack) ? 92 : 20,
    }
  );
}

function ancestorContext(element: HtmlElement) {
  const chunks: string[] = [];
  let current = element.parentNode as HtmlNode | null;
  for (let depth = 0; current && depth < 3; depth += 1) {
    if ("tagName" in current) {
      const candidate = current as HtmlElement;
      if (["section", "fieldset"].includes(candidate.tagName)) {
        chunks.push(textContent(candidate).slice(0, 500));
      }
    }
    current = "parentNode" in current ? (current.parentNode as HtmlNode | null) : null;
  }
  return chunks.join(" ");
}

function stableSelector(element: HtmlElement) {
  const id = attribute(element, "id");
  if (id) return `#${cssEscape(id)}`;
  const name = attribute(element, "name");
  if (name) return `${element.tagName}[name="${cssAttributeEscape(name)}"]`;
  const autocomplete = attribute(element, "autocomplete");
  if (autocomplete) {
    return `${element.tagName}[autocomplete="${cssAttributeEscape(autocomplete)}"]`;
  }
  const type = attribute(element, "type");
  return `${element.tagName}${type ? `[type="${cssAttributeEscape(type)}"]` : ""}`;
}

function rootSelectorFor(element: HtmlElement) {
  const form = closestAncestor(element, "form");
  const formSelector = form ? stableRootSelector(form) : null;
  if (formSelector) return formSelector;
  let current = element.parentNode as HtmlNode | null;
  while (current) {
    if ("tagName" in current) {
      const candidate = current as HtmlElement;
      if (attribute(candidate, "role") === "dialog") {
        return stableRootSelector(candidate) ?? "body";
      }
    }
    current = "parentNode" in current ? (current.parentNode as HtmlNode | null) : null;
  }
  return "body";
}

function stableRootSelector(element: HtmlElement): string | null {
  const id = attribute(element, "id");
  if (id) return `#${cssEscape(id)}`;
  const name = attribute(element, "name");
  if (name) return `${element.tagName}[name="${cssAttributeEscape(name)}"]`;
  const ariaLabel = attribute(element, "aria-label");
  if (ariaLabel) {
    return `${element.tagName}[aria-label="${cssAttributeEscape(ariaLabel)}"]`;
  }
  return null;
}

function attribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((attributeValue) => attributeValue.name === name)?.value ?? null;
}

function hasAttribute(element: HtmlElement, name: string): boolean {
  return element.attrs.some((attributeValue) => attributeValue.name === name);
}

function closestAncestor(element: HtmlElement, tagName: string): HtmlElement | null {
  let current = element.parentNode as HtmlNode | null;
  while (current) {
    if ("tagName" in current && (current as HtmlElement).tagName === tagName) {
      return current as HtmlElement;
    }
    current = "parentNode" in current ? (current.parentNode as HtmlNode | null) : null;
  }
  return null;
}

function textContent(node: HtmlNode | null): string {
  if (!node) return "";
  if ("value" in node && typeof node.value === "string") return node.value;
  if (!("childNodes" in node)) return "";
  return compactText(node.childNodes.map((child) => textContent(child)).join(" "));
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDetectionText(value: string) {
  return compactText(value)
    .toLocaleLowerCase("cs-CZ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sanitizedUrlForStorage(url: URL) {
  const sanitized = new URL(url);
  sanitized.search = "";
  sanitized.hash = "";
  return sanitized.toString();
}

function cssEscape(value: string) {
  return value.replace(
    /[^A-Za-z0-9_-]/g,
    (character) => `\\${character.codePointAt(0)?.toString(16)} `,
  );
}

function cssAttributeEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
