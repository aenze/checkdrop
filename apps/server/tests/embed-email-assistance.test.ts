import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { minifyEmbedScript } from "../scripts/minify-embed.mjs";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

const variants = [
  ["source", CHECKDROP_EMBED_SCRIPT],
  ["minified", await minifyEmbedScript(CHECKDROP_EMBED_SCRIPT)],
] as const;

const REQUEST_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});

type Reply = { ok: boolean; body?: unknown } | "offline" | Promise<{ ok: boolean; body?: unknown }>;
const email = (overrides: object = {}) => ({
  selector: "#email",
  canonical_field: "email",
  context: "billing",
  condition_key: null,
  required: false,
  require_complete_name: false,
  validation_mode: "suggest",
  validation_trigger: "blur",
  ...overrides,
});

async function fixture(scriptSource: string, reply: (path: string) => Reply, field = email()) {
  const dom = new JSDOM(
    '<form id="order"><input id="email"><input id="other"><button type="submit">Objednat</button></form>',
    { url: "https://shop.test/kosik", runScripts: "dangerously", pretendToBeVisual: true },
  );
  windows.push(dom);
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/v1/integration/config")
      return {
        ok: true,
        json: async () => ({
          state: "shadow",
          forms: [{ id: "checkout", name: "Checkout", root_selector: "body", fields: [field] }],
        }),
      };
    if (path !== "/v1/emails/validate") return { ok: true, json: async () => ({}) };
    const answer = await reply(path);
    if (answer === "offline") throw new Error("offline");
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return { ok: answer.ok, json: async () => answer.body };
  });
  Object.assign(window, { fetch });
  const timings: { source: string; outcome: string }[] = [];
  window.document.addEventListener("checkdrop:assist-timing", (event) =>
    timings.push((event as CustomEvent).detail),
  );
  const ready = new Promise<void>((resolve) =>
    window.document.addEventListener("checkdrop:ready", () => resolve(), { once: true }),
  );
  const script = window.document.createElement("script");
  script.dataset.checkdropSite = "test-site";
  script.dataset.checkdropApi = "https://api.test";
  script.textContent = scriptSource;
  window.document.body.append(script);
  await ready;
  const input = window.document.querySelector("#email") as HTMLInputElement;
  const type = (value: string, init: { isComposing?: boolean } = {}) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new window.InputEvent("input", { bubbles: true, ...init }));
  };
  const leave = () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    input.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    input.blur();
  };
  const prompt = () => window.document.querySelector(".checkdrop-field-assist");
  const button = (label: string) =>
    [...window.document.querySelectorAll(".checkdrop-field-assist button")].find(
      (element) => element.textContent === label,
    ) as HTMLButtonElement | undefined;
  const interactions = () =>
    fetch.mock.calls
      .filter(([url]) => String(url).includes("/v1/assist/interactions"))
      .map(([, init]) => JSON.parse(String(init?.body)) as { request_id: string; event: string });
  const validations = () =>
    fetch.mock.calls.filter(([url]) => String(url).includes("/v1/emails/validate")).length;
  return { window, input, type, leave, prompt, button, interactions, validations, timings };
}

const correctable = (suggestion: string) => ({
  ok: true,
  body: {
    request_id: REQUEST_ID,
    status: "correctable",
    action: "suggest",
    suggestion,
    issues: [{ code: "email.domain_typo" }],
  },
});
const valid = {
  ok: true,
  body: { request_id: REQUEST_ID, status: "valid", action: "accept", suggestion: null, issues: [] },
};

describe.each(variants)("instant e-mail corrections (%s script)", (_variant, scriptSource) => {
  it("offers a known typo before any response and keeps the typed value", async () => {
    const f = await fixture(scriptSource, () => new Promise(() => undefined));
    f.type("Alice+shop@gmial.com");
    expect(f.prompt()?.textContent).toContain("gmail.com");
    expect(f.input.value).toBe("Alice+shop@gmial.com");
    expect(f.validations()).toBe(0);
    expect(f.timings).toEqual([]); // reported after the next frame
    await vi.waitFor(() =>
      expect(f.timings[0]).toMatchObject({ source: "local", outcome: "shown" }),
    );
    const submit = new f.window.SubmitEvent("submit", { bubbles: true, cancelable: true });
    f.window.document.querySelector("#order")?.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(false);
  });

  it("sends interactions only with the server's request_id, in order", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(scriptSource, async () => {
      await pending;
      return correctable("jana@gmail.com");
    });
    f.type("jana@gmial.com");
    f.leave();
    f.button("Opravit")?.click();
    expect(f.input.value).toBe("jana@gmail.com");
    expect(f.interactions()).toEqual([]);
    release();
    await vi.waitFor(() =>
      expect(f.interactions()).toEqual([
        { request_id: REQUEST_ID, event: "shown" },
        { request_id: REQUEST_ID, event: "applied" },
      ]),
    );
  });

  it("records keeping the original value", async () => {
    const f = await fixture(scriptSource, () => correctable("jana@gmail.com"));
    f.type("jana@gmial.com");
    f.leave();
    f.button("Ponechat")?.click();
    expect(f.input.value).toBe("jana@gmial.com");
    await vi.waitFor(() =>
      expect(f.interactions().map((item) => item.event)).toEqual(["shown", "kept"]),
    );
  });

  it("withdraws an untouched offer when the server confirms the typed domain works", async () => {
    const f = await fixture(scriptSource, () => valid);
    f.type("jana@gmial.com");
    expect(f.prompt()).not.toBeNull();
    f.leave();
    await vi.waitFor(() => expect(f.prompt()).toBeNull());
    expect(f.input.value).toBe("jana@gmial.com");
    expect(f.interactions()).toEqual([]);
  });

  it("keeps a choice the customer already made when a later answer disagrees", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(scriptSource, async () => {
      await pending;
      return valid;
    });
    f.type("jana@gmial.com");
    f.leave();
    f.button("Opravit")?.click();
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.input.value).toBe("jana@gmail.com");
    expect(f.interactions()).toEqual([]);
  });

  it("keeps the offer but sends nothing when the API is unavailable", async () => {
    const f = await fixture(scriptSource, () => "offline");
    f.type("jana@gmial.com");
    f.leave();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.prompt()?.textContent).toContain("gmail.com");
    f.button("Opravit")?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.interactions()).toEqual([]);
  });

  it("shows no instant offer for shadow fields, IME composition or typos outside the list", async () => {
    const shadow = await fixture(scriptSource, () => valid, email({ validation_mode: "shadow" }));
    shadow.type("jana@gmial.com");
    expect(shadow.prompt()).toBeNull();

    const ime = await fixture(scriptSource, () => valid);
    ime.type("jana@gmial.com", { isComposing: true });
    expect(ime.prompt()).toBeNull();

    const other = await fixture(scriptSource, () => correctable("jana@gmail.com"));
    other.type("jana@gmeil.com");
    expect(other.prompt()).toBeNull();
    other.leave();
    await vi.waitFor(() => expect(other.prompt()?.textContent).toContain("gmail.com"));
    await vi.waitFor(() => expect(other.timings[0]).toMatchObject({ source: "api" }));
  });

  it("does not flag an unfinished address while the customer is still typing", async () => {
    const f = await fixture(
      scriptSource,
      () => ({
        ok: true,
        body: {
          request_id: REQUEST_ID,
          status: "invalid",
          action: "warn",
          issues: [{ code: "email.syntax_invalid" }],
        },
      }),
      email({ validation_trigger: "input" }),
    );
    f.type("jana@");
    await vi.waitFor(() => expect(f.validations()).toBe(1), { timeout: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.window.document.querySelector(".checkdrop-field-assist-warning")).toBeNull();
  });
});
