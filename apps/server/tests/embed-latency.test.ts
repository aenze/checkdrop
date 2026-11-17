import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { minifyEmbedScript } from "../scripts/minify-embed.mjs";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

// Every behavior below must hold for the readable source and for the minified production asset.
const variants = [
  ["source", CHECKDROP_EMBED_SCRIPT],
  ["minified", await minifyEmbedScript(CHECKDROP_EMBED_SCRIPT)],
] as const;

type Timing = {
  field: string;
  context: string;
  source: string;
  outcome: string;
  inputToRenderMs: number | null;
  requestMs: number | null;
};

const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});

const baseField = {
  context: "billing",
  condition_key: null,
  required: false,
  require_complete_name: false,
};
const fields = [
  {
    ...baseField,
    selector: "#email",
    canonical_field: "email",
    validation_mode: "suggest",
    validation_trigger: "blur",
  },
  {
    ...baseField,
    selector: "#country",
    canonical_field: "country",
    validation_mode: "shadow",
    validation_trigger: "blur",
  },
  {
    ...baseField,
    selector: "#street",
    canonical_field: "street_line",
    validation_mode: "suggest",
    validation_trigger: "input",
  },
  {
    ...baseField,
    selector: "#city",
    canonical_field: "city",
    validation_mode: "shadow",
    validation_trigger: "blur",
  },
  {
    ...baseField,
    selector: "#zip",
    canonical_field: "postal_code",
    validation_mode: "shadow",
    validation_trigger: "blur",
  },
  {
    ...baseField,
    selector: "#phone",
    canonical_field: "phone",
    validation_mode: "shadow",
    validation_trigger: "blur",
  },
];

type Reply = { ok: boolean; body?: unknown } | Promise<{ ok: boolean; body?: unknown }> | "offline";

async function fixture(
  reply: (path: string) => Reply,
  scriptSource: string,
  mappedFields: readonly object[] = fields,
) {
  const dom = new JSDOM(
    '<form id="order"><input id="email"><input id="country" value="CZ"><input id="street"><input id="city"><input id="zip"><input id="phone"><button type="submit">Objednat</button></form>',
    { url: "https://shop.test/kosik", runScripts: "dangerously", pretendToBeVisual: true },
  );
  windows.push(dom);
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () {
    return (this.closest("[hidden]") ? [] : [{}]) as unknown as DOMRectList;
  };
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/config?"))
      return {
        ok: true,
        json: async () => ({
          state: "shadow",
          forms: [
            { id: "checkout", name: "Checkout", root_selector: "body", fields: mappedFields },
          ],
        }),
      };
    const path = new URL(url).pathname;
    const answer = await reply(path);
    if (answer === "offline") throw new Error("API offline");
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return { ok: answer.ok, json: async () => answer.body };
  });
  Object.assign(window, { fetch });
  const timings: Timing[] = [];
  window.document.addEventListener("checkdrop:assist-timing", (event) => {
    timings.push((event as CustomEvent<Timing>).detail);
  });
  const ready = new Promise<void>((resolve) =>
    window.document.addEventListener("checkdrop:ready", () => resolve(), { once: true }),
  );
  const script = window.document.createElement("script");
  script.dataset.checkdropSite = "test-site";
  script.dataset.checkdropApi = "https://api.test";
  script.textContent = scriptSource;
  window.document.body.append(script);
  await ready;
  const control = (selector: string) => window.document.querySelector(selector) as HTMLInputElement;
  const type = (selector: string, value: string) => {
    control(selector).value = value;
    control(selector).dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const leave = (selector: string) =>
    control(selector).dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  return { window, fetch, timings, type, leave, control };
}

const addressMatch = {
  ok: true,
  body: {
    request_id: "req-address",
    status: "matched",
    suggestions: [
      {
        id: "1",
        label: "Sokolská 134, 272 01 Lhota",
        street_line: "Sokolská 134",
        city: "Lhota",
        postal_code: "27201",
      },
    ],
  },
};

describe.each(variants)("hosted assistance timing (%s script)", (_variant, scriptSource) => {
  const setup = (reply: (path: string) => Reply, mappedFields?: readonly object[]) =>
    fixture(reply, scriptSource, mappedFields);

  it("reports a shown address suggestion after rendering, without customer values", async () => {
    const f = await setup(() => addressMatch);
    f.type("#street", "Sokolská 13");
    await vi.waitFor(() => expect(f.timings).toHaveLength(1), { timeout: 3_000 });
    const [timing] = f.timings;
    expect(timing).toEqual({
      field: "street_line",
      context: "billing",
      source: "api",
      outcome: "shown",
      inputToRenderMs: expect.any(Number),
      requestMs: expect.any(Number),
    });
    // The input debounce is part of the customer's wait.
    expect(timing?.inputToRenderMs).toBeGreaterThanOrEqual(190);
    expect(timing?.inputToRenderMs).toBeGreaterThanOrEqual(timing?.requestMs ?? Infinity);
    expect(f.window.document.querySelector(".checkdrop-address-assist")).not.toBeNull();
    expect(JSON.stringify(f.timings)).not.toMatch(/@|Sokolsk|Lhota|site|req-|session/);
  });

  it("reports an e-mail correction shown on blur", async () => {
    const f = await setup(() => ({
      ok: true,
      body: {
        request_id: "req-email",
        status: "correctable",
        action: "suggest",
        suggestion: "jana@gmail.com",
        issues: [{ code: "email.domain_typo" }],
      },
    }));
    f.type("#email", "jana@gmial.com");
    f.leave("#email");
    await vi.waitFor(() => expect(f.timings).toHaveLength(1));
    // gmial.com is in the reviewed instant list, so the offer appears before any request.
    expect(f.timings[0]).toMatchObject({ field: "email", outcome: "shown", source: "local" });
    expect(f.timings[0]?.inputToRenderMs).toEqual(expect.any(Number));
    expect(f.control("#email").value).toBe("jana@gmial.com");
    expect(JSON.stringify(f.timings)).not.toMatch(/gmial|gmail|jana/);
  });

  it("reports no_match when the API answers without a visible hint", async () => {
    const f = await setup(() => ({
      ok: true,
      body: { request_id: "req-email", status: "valid", suggestion: null },
    }));
    f.type("#email", "jana@example.cz");
    f.leave("#email");
    await vi.waitFor(() => expect(f.timings).toHaveLength(1));
    expect(f.timings[0]).toMatchObject({ outcome: "no_match", inputToRenderMs: null });
    expect(f.timings[0]?.requestMs).toEqual(expect.any(Number));
  });

  it("reports unavailable without a render time when the API is offline", async () => {
    const f = await setup(() => "offline");
    f.type("#email", "jana@example.cz");
    f.leave("#email");
    await vi.waitFor(() => expect(f.timings).toHaveLength(1));
    expect(f.timings[0]).toMatchObject({
      field: "email",
      outcome: "unavailable",
      inputToRenderMs: null,
      requestMs: null,
    });
    expect(f.window.document.querySelector(".checkdrop-field-assist")).toBeNull();
  });

  it("reports a superseded address request as aborted, never as a fast render", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const f = await setup(async (path) => {
      if (!path.startsWith("/v1/addresses/")) return { ok: true, body: {} };
      calls += 1;
      if (calls === 1) await pending;
      return addressMatch;
    });
    f.type("#street", "Sokolská 1");
    await vi.waitFor(() => expect(calls).toBe(1), { timeout: 3_000 });
    f.type("#street", "Sokolská 13");
    release();
    await vi.waitFor(
      () => expect(f.timings.map((timing) => timing.outcome)).toEqual(["aborted", "shown"]),
      {
        timeout: 3_000,
      },
    );
    expect(f.timings[0]?.inputToRenderMs).toBeNull();
  });

  it("sends one e-mail check when leaving the field fires change and focusout", async () => {
    const f = await setup(() => ({
      ok: true,
      body: { request_id: "req-email", status: "valid", suggestion: null },
    }));
    f.control("#email").value = "jana@example.cz";
    f.control("#email").dispatchEvent(new f.window.Event("input", { bubbles: true }));
    f.control("#email").dispatchEvent(new f.window.Event("change", { bubbles: true }));
    f.leave("#email");
    await vi.waitFor(() => expect(f.timings).toHaveLength(1));
    const emailCalls = f.fetch.mock.calls.filter(([url]) => String(url).includes("/emails/"));
    expect(emailCalls).toHaveLength(1);
    expect(f.timings[0]?.outcome).toBe("no_match");
  });

  it("restarts a street check when only trailing whitespace changes during a request", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const f = await setup(async (path) => {
      if (!path.startsWith("/v1/addresses/")) return { ok: true, body: {} };
      calls += 1;
      if (calls === 1) await pending;
      return addressMatch;
    });
    f.type("#street", "Sokolská 13");
    await vi.waitFor(() => expect(calls).toBe(1), { timeout: 1_000 });
    f.type("#street", "Sokolská 13 ");
    release();
    await vi.waitFor(
      () => expect(f.timings.map((timing) => timing.outcome)).toEqual(["aborted", "shown"]),
      { timeout: 1_000 },
    );
    expect(f.window.document.querySelector(".checkdrop-address-assist")).not.toBeNull();
  });

  it("waits 200 ms after the last street keystroke", async () => {
    const f = await setup(() => addressMatch);
    const addressCalls = () =>
      f.fetch.mock.calls.filter(([url]) => String(url).includes("/addresses/")).length;
    f.type("#street", "Sokolská 13");
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(addressCalls()).toBe(0);
    await vi.waitFor(() => expect(addressCalls()).toBe(1), { timeout: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(addressCalls()).toBe(1);
  });

  it("sends a pending street check immediately on blur, exactly once", async () => {
    const f = await setup(() => addressMatch);
    const addressCalls = () =>
      f.fetch.mock.calls.filter(([url]) => String(url).includes("/addresses/")).length;
    f.type("#street", "Sokolská 13");
    await new Promise((resolve) => setTimeout(resolve, 50));
    f.control("#street").dispatchEvent(new f.window.Event("change", { bubbles: true }));
    f.leave("#street");
    await vi.waitFor(() => expect(addressCalls()).toBe(1), { timeout: 100 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(addressCalls()).toBe(1);
  });

  it("does not search while an IME composition is active", async () => {
    const f = await setup(() => addressMatch);
    const addressCalls = () =>
      f.fetch.mock.calls.filter(([url]) => String(url).includes("/addresses/")).length;
    const street = f.control("#street");
    street.dispatchEvent(new f.window.CompositionEvent("compositionstart", { bubbles: true }));
    street.value = "Sokolská 13";
    street.dispatchEvent(new f.window.InputEvent("input", { bubbles: true, isComposing: true }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(addressCalls()).toBe(0);
    street.dispatchEvent(new f.window.CompositionEvent("compositionend", { bubbles: true }));
    await vi.waitFor(() => expect(addressCalls()).toBe(1), { timeout: 1_000 });
  });

  it("still blocks an incomplete required name before submit", async () => {
    const f = await setup(
      () => ({ ok: true, body: { status: "valid" } }),
      [
        {
          ...baseField,
          selector: "#email",
          canonical_field: "full_name",
          required: true,
          require_complete_name: true,
          validation_mode: "shadow",
          validation_trigger: "blur",
        },
      ],
    );
    f.type("#email", "Jana");
    const submit = new f.window.SubmitEvent("submit", { bubbles: true, cancelable: true });
    f.window.document.querySelector("#order")?.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(f.control("#email").getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps the configuration uncached but lets POST checks reuse CORS preflights", async () => {
    const f = await setup(() => ({
      ok: true,
      body: { request_id: "req-email", status: "valid", suggestion: null },
    }));
    f.type("#email", "jana@example.cz");
    f.leave("#email");
    await vi.waitFor(() => expect(f.timings).toHaveLength(1));
    const calls = f.fetch.mock.calls.map(([url, init]) => ({
      path: new URL(String(url)).pathname,
      method: init?.method,
      cache: init?.cache,
    }));
    expect(calls.find((call) => call.path === "/v1/integration/config")).toMatchObject({
      method: "GET",
      cache: "no-store",
    });
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts.map((call) => call.path)).toContain("/v1/emails/validate");
    expect(posts.every((call) => call.cache === "default")).toBe(true);
  });

  it("does not report timing for shadow-only fields", async () => {
    const f = await setup(() => ({ ok: true, body: { status: "valid" } }));
    f.type("#phone", "777 123 456");
    f.leave("#phone");
    await vi.waitFor(() =>
      expect(f.fetch.mock.calls.some(([url]) => String(url).includes("/phones/"))).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.timings).toEqual([]);
  });
});
