import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { minifyEmbedScript } from "../scripts/minify-embed.mjs";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

const variants = [
  ["source", CHECKDROP_EMBED_SCRIPT],
  ["minified", await minifyEmbedScript(CHECKDROP_EMBED_SCRIPT)],
] as const;

const STORAGE_KEY = "checkdrop:config:https://api.test|test-site|/kosik";
const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});

const configFor = (version: number) => ({
  object: "integration_config",
  state: "shadow",
  config_version: version,
  forms: [
    {
      id: "checkout",
      name: "Checkout",
      root_selector: "body",
      fields: [
        {
          selector: "#email",
          canonical_field: "email",
          context: "billing",
          condition_key: null,
          required: false,
          validation_mode: "suggest",
          validation_trigger: "blur",
        },
      ],
    },
  ],
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const validEmail = () =>
  json({ request_id: "0f8fad5b-d9cb-469f-a165-70867728950e", status: "valid", issues: [] });

interface FixtureOptions {
  readonly config?: () => Promise<Response> | Response;
  readonly validate?: () => Promise<Response> | Response;
  readonly prepare?: (window: JSDOM["window"]) => void;
}

function fixture(scriptSource: string, options: FixtureOptions = {}) {
  const dom = new JSDOM('<form id="order"><input id="email"><input id="other"></form>', {
    url: "https://shop.test/kosik",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  windows.push(dom);
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/v1/integration/config")
      return options.config ? options.config() : json(configFor(4));
    if (path === "/v1/emails/validate") return options.validate ? options.validate() : validEmail();
    return json({});
  });
  Object.assign(window, { fetch });
  const ready: (number | null)[] = [];
  window.document.addEventListener("checkdrop:ready", (event) =>
    ready.push((event as CustomEvent<{ configVersion: number | null }>).detail.configVersion),
  );
  options.prepare?.(window);
  const script = window.document.createElement("script");
  script.dataset.checkdropSite = "test-site";
  script.dataset.checkdropApi = "https://api.test";
  script.textContent = scriptSource;
  window.document.body.append(script);
  const input = window.document.querySelector("#email") as HTMLInputElement;
  const check = (value: string) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    input.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    input.blur();
  };
  const calls = (path: string) =>
    fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === path);
  return { window, fetch, ready, check, calls };
}

describe.each(variants)("hosted script network behaviour (%s script)", (_variant, source) => {
  it("posts checks as text/plain JSON without credentials, so no preflight is needed", async () => {
    const f = fixture(source);
    await vi.waitFor(() => expect(f.ready).toEqual([4]));
    f.check("jana@example.cz");
    await vi.waitFor(() => expect(f.calls("/v1/emails/validate")).toHaveLength(1));
    const [url, init] = f.calls("/v1/emails/validate")[0] ?? [];
    expect(String(url)).toMatch(/[?&]session=[0-9a-f-]{36}/);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    });
    expect(Object.keys(init?.headers ?? {})).toEqual(["Content-Type"]);
    expect(JSON.parse(String(init?.body))).toMatchObject({ email: "jana@example.cz" });
    expect(String(f.calls("/v1/integration/config")[0]?.[0])).toMatch(/[?&]session=[0-9a-f-]{36}/);
  });

  it("stops sending checks after a 429 until Retry-After has passed", async () => {
    let throttled = true;
    const f = fixture(source, {
      validate: () =>
        throttled
          ? json({ title: "Too many requests" }, 429, { "Retry-After": "30" })
          : validEmail(),
    });
    await vi.waitFor(() => expect(f.ready).toEqual([4]));
    const realNow = f.window.Date.now.bind(f.window.Date);
    let offset = 0;
    f.window.Date.now = () => realNow() + offset;
    f.check("jana@example.cz");
    await vi.waitFor(() => expect(f.calls("/v1/emails/validate")).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    throttled = false;
    f.check("petr@example.cz");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.calls("/v1/emails/validate")).toHaveLength(1);
    expect(f.window.document.querySelector(".checkdrop-field-assist")).toBeNull();
    offset = 31_000;
    f.check("eva@example.cz");
    await vi.waitFor(() => expect(f.calls("/v1/emails/validate")).toHaveLength(2));
  });

  it("activates a stored config at once and applies a changed answer from the background refresh", async () => {
    let answer: (response: Response) => void = () => undefined;
    const f = fixture(source, {
      config: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
      prepare: (window) =>
        window.sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ at: window.Date.now() - 60_000, config: configFor(4) }),
        ),
    });
    // Ready before the network has answered.
    await vi.waitFor(() => expect(f.ready).toEqual([4]));
    expect(f.calls("/v1/integration/config")).toHaveLength(1);
    answer(json({ ...configFor(5), request_id: "req-1" }));
    await vi.waitFor(() => expect(f.ready).toEqual([4, 5]));
    const stored = JSON.parse(f.window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stored.config).toEqual(configFor(5));
    expect(stored.config).not.toHaveProperty("request_id");
  });

  it("keeps the running observation when the refresh brings the same config", async () => {
    const f = fixture(source, {
      config: () => json({ ...configFor(4), request_id: "req-2" }),
      prepare: (window) =>
        window.sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ at: window.Date.now(), config: configFor(4) }),
        ),
    });
    await vi.waitFor(() => expect(f.calls("/v1/integration/config")).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.ready).toEqual([4]);
  });

  it("ignores a stored config older than 10 minutes", async () => {
    let answer: (response: Response) => void = () => undefined;
    const f = fixture(source, {
      config: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
      prepare: (window) =>
        window.sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ at: window.Date.now() - 600_001, config: configFor(3) }),
        ),
    });
    await vi.waitFor(() => expect(f.calls("/v1/integration/config")).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.ready).toEqual([]);
    answer(json(configFor(4)));
    await vi.waitFor(() => expect(f.ready).toEqual([4]));
  });

  it("retires the stored config when the API refuses the site", async () => {
    const f = fixture(source, {
      config: () => json({ title: "Embed unavailable" }, 403),
      prepare: (window) =>
        window.sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ at: window.Date.now(), config: configFor(4) }),
        ),
    });
    await vi.waitFor(() => expect(f.window.sessionStorage.getItem(STORAGE_KEY)).toBeNull());
    expect(f.ready).toEqual([4]);
    f.check("jana@example.cz");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.calls("/v1/emails/validate")).toHaveLength(0);
  });

  it("keeps the stored config working when the API is busy or failing", async () => {
    const f = fixture(source, {
      config: () => json({ title: "Unavailable" }, 503),
      prepare: (window) =>
        window.sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ at: window.Date.now(), config: configFor(4) }),
        ),
    });
    await vi.waitFor(() => expect(f.calls("/v1/integration/config")).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    f.check("jana@example.cz");
    await vi.waitFor(() => expect(f.calls("/v1/emails/validate")).toHaveLength(1));
  });

  it("still starts from the network when storage throws", async () => {
    const f = fixture(source, {
      prepare: (window) =>
        Object.defineProperty(window, "sessionStorage", {
          configurable: true,
          get() {
            throw new Error("Storage is blocked");
          },
        }),
    });
    await vi.waitFor(() => expect(f.ready).toEqual([4]));
    f.check("jana@example.cz");
    await vi.waitFor(() => expect(f.calls("/v1/emails/validate")).toHaveLength(1));
  });
});
