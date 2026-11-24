import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});

const phone = {
  selector: "#phone",
  canonical_field: "phone",
  context: "billing",
  condition_key: null,
  required: true,
  require_complete_name: false,
  require_valid_phone: true,
  validation_mode: "suggest",
  validation_trigger: "blur",
};
const html =
  '<form id="order"><input id="name"><input id="phone"><button id="finish" type="submit">Objednat</button><button id="helper" type="submit">Přepočítat</button></form>';

async function fixture(
  fields: object[] = [phone],
  markup = html,
  apiResult: object | null = null,
  config: "ok" | "offline" = "ok",
) {
  const dom = new JSDOM(markup, {
    url: "https://shop.test/kosik",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  windows.push(dom);
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () {
    return (this.closest("[hidden]") ? [] : [{}]) as unknown as DOMRectList;
  };
  const fetch = vi.fn(async (url: string, _options?: RequestInit) => {
    if (url.includes("/config?")) {
      if (config === "offline") throw new Error("API offline");
      return {
        ok: true,
        json: async () => ({
          state: "shadow",
          forms: [{ id: "checkout", name: "Checkout", root_selector: "body", fields }],
        }),
      };
    }
    if (url.includes("/checkout/events")) return { ok: true, json: async () => ({}) };
    if (apiResult) return { ok: true, json: async () => apiResult };
    throw new Error("API offline");
  });
  Object.assign(window, { fetch, AbortSignal });
  const ready = new Promise<void>((resolve) =>
    window.document.addEventListener("checkdrop:ready", () => resolve(), { once: true }),
  );
  const script = window.document.createElement("script");
  script.dataset.checkdropSite = "test-site";
  script.dataset.checkdropApi = "https://api.test";
  script.textContent = CHECKDROP_EMBED_SCRIPT;
  window.document.body.append(script);
  if (config === "ok") await ready;
  else await new Promise((resolve) => setTimeout(resolve, 20));
  const input = (selector = "#phone") => window.document.querySelector<HTMLInputElement>(selector)!;
  // A value the shop rendered on the page, such as a logged-in customer's saved contact.
  const set = (value: string, selector = "#phone") => {
    input(selector).value = value;
  };
  const edit = (value: string, selector = "#phone") => {
    set(value, selector);
    input(selector).dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const leave = (selector = "#phone") =>
    input(selector).dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  const submit = (selector = "#order", submitter: string | null = "#finish") => {
    const event = new window.SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: submitter ? window.document.querySelector<HTMLButtonElement>(submitter) : null,
    });
    window.document.querySelector(selector)!.dispatchEvent(event);
    return event;
  };
  const warning = () =>
    window.document.querySelector(".checkdrop-field-assist-warning")?.textContent ?? null;
  const records = () =>
    fetch.mock.calls
      .filter(([url]) => String(url).includes("/checkout/events"))
      .map(([, options]) => JSON.parse(String(options?.body)));
  return { window, input, set, edit, leave, submit, warning, records, fetch };
}

describe("required phone in the hosted script", () => {
  it.each([
    ["", "Doplňte telefon"],
    ["+420 ", "Doplňte telefon"],
    ["jana.novakova@seznam.cz", "ne e-mail"],
    ["777 123", "České číslo má 9 číslic"],
    // The value of the 24. 11. order that went through on a stale copy of the script.
    ["+420 777 836", "České číslo má 9 číslic"],
    ["nemám telefon", "České číslo má 9 číslic"],
  ])("blocks %j with a message at the field and focuses it", async (value, text) => {
    const f = await fixture();
    const shop = vi.fn();
    f.window.document.querySelector("#order")!.addEventListener("submit", shop);
    f.set(value);
    expect(f.submit().defaultPrevented).toBe(true);
    expect(shop).not.toHaveBeenCalled();
    expect(f.input().getAttribute("aria-invalid")).toBe("true");
    expect(f.warning()).toContain(text);
    expect(f.window.document.activeElement).toBe(f.input());
  });

  it.each([
    "777123456",
    "777 123 456",
    "+420 777 123 456",
    "00420777123456",
    "+421 905 123 456",
    "0905 123 456",
    "+49 30 1234567",
  ])("lets %j through without waiting for formatting or the API", async (value) => {
    const f = await fixture();
    f.set(value);
    expect(f.submit().defaultPrevented).toBe(false);
    expect(f.input().hasAttribute("aria-invalid")).toBe(false);
    expect(f.warning()).toBeNull();
  });

  it("records the block as checkdrop_phone without the value, then lets the fixed number go", async () => {
    const f = await fixture();
    f.set("jana.novakova@seznam.cz");
    f.submit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.records().map((record) => record.event)).toEqual([
      "started",
      "submit_attempt",
      "blocked",
    ]);
    expect(f.records().at(-1)).toMatchObject({ reason: "checkdrop_phone", field: "phone" });
    expect(JSON.stringify(f.records())).not.toContain("seznam");
    f.edit("777 123 456");
    expect(f.input().hasAttribute("aria-invalid")).toBe(false);
    expect(f.warning()).toBeNull();
    expect(f.submit().defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.records().at(-1).event).toBe("submit_dispatched");
  });

  it("points out a wrong number on leaving the field, but not an empty one", async () => {
    const f = await fixture([{ ...phone, validation_mode: "shadow" }]);
    f.leave();
    expect(f.warning()).toBeNull();
    f.edit("jana@example.com");
    f.leave();
    expect(f.warning()).toContain("ne e-mail");
    f.edit("602 123 456");
    expect(f.warning()).toBeNull();
    expect(f.submit().defaultPrevented).toBe(false);
  });

  it("keeps the local message when the validation API answers differently", async () => {
    const f = await fixture(
      [
        phone,
        {
          ...phone,
          selector: "#country",
          canonical_field: "country",
          require_valid_phone: false,
          validation_mode: "shadow",
        },
      ],
      '<form id="order"><input id="country" value="CZ"><input id="phone"><button id="finish" type="submit">Objednat</button></form>',
      { status: "invalid", action: "warn", issues: [{ code: "phone.number_impossible" }] },
    );
    f.set("jana@example.com");
    f.leave();
    await vi.waitFor(() =>
      expect(f.fetch.mock.calls.some(([url]) => String(url).includes("/v1/phones/validate"))).toBe(
        true,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.warning()).toContain("ne e-mail");
  });

  it("guards only the final AJAX button named by submit_selector", async () => {
    const f = await fixture(
      [{ ...phone, submit_selector: ".JS_orderSendButton" }],
      '<form id="order"><input id="phone" value="jana@example.com"><button class="recalculate" type="button">Přepočítat</button><button class="JS_orderSendButton" type="button"><span id="icon">Odeslat objednávku</span></button></form>',
    );
    const ajax = vi.fn();
    f.window.document.addEventListener("click", ajax);
    f.window.document.querySelector<HTMLElement>(".recalculate")!.click();
    expect(ajax).toHaveBeenCalledOnce();
    f.window.document.querySelector<HTMLElement>("#icon")!.click();
    expect(ajax).toHaveBeenCalledOnce();
    expect(f.warning()).toContain("ne e-mail");
    f.edit("+420 777 123 456");
    f.window.document.querySelector<HTMLElement>("#icon")!.click();
    expect(ajax).toHaveBeenCalledTimes(2);
  });

  it("ignores helper submits, hidden, disabled and inactive phone fields", async () => {
    const f = await fixture(
      [
        { ...phone, condition_key: "customer_type=private", submit_selector: "#finish" },
        {
          ...phone,
          selector: "#type",
          canonical_field: "customer_type",
          context: "shared",
          require_valid_phone: false,
          validation_mode: "shadow",
        },
      ],
      '<form id="order"><select id="type"><option value="company">Firma</option><option value="private">Soukromě</option></select><input id="phone"><button id="finish" type="submit">Objednat</button><button id="helper" type="submit">Přepočítat</button></form>',
    );
    expect(f.submit().defaultPrevented).toBe(false);
    f.window.document.querySelector<HTMLSelectElement>("#type")!.value = "private";
    expect(f.submit("#order", "#helper").defaultPrevented).toBe(false);
    expect(f.submit().defaultPrevented).toBe(true);
    f.input().disabled = true;
    expect(f.submit().defaultPrevented).toBe(false);
    f.input().disabled = false;
    f.input().hidden = true;
    expect(f.submit().defaultPrevented).toBe(false);
  });

  it("shows both a missing name and a missing phone and focuses the first", async () => {
    const f = await fixture([
      {
        ...phone,
        selector: "#name",
        canonical_field: "full_name",
        require_complete_name: true,
        require_valid_phone: false,
        validation_mode: "shadow",
      },
      phone,
    ]);
    f.set("Jana", "#name");
    expect(f.submit().defaultPrevented).toBe(true);
    expect(f.input("#name").getAttribute("aria-invalid")).toBe("true");
    expect(f.input().getAttribute("aria-invalid")).toBe("true");
    expect(f.window.document.activeElement).toBe(f.input("#name"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.records().at(-1)).toMatchObject({ event: "blocked", reason: "checkdrop_name" });
    f.edit("Jana Nováková", "#name");
    expect(f.submit().defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.records().at(-1)).toMatchObject({ event: "blocked", reason: "checkdrop_phone" });
  });

  it("never blocks without the flag, or when the configuration cannot load", async () => {
    const legacy = await fixture([{ ...phone, require_valid_phone: false }]);
    legacy.set("jana@example.com");
    expect(legacy.submit().defaultPrevented).toBe(false);
    const offline = await fixture(undefined, undefined, null, "offline");
    offline.set("jana@example.com");
    expect(offline.submit().defaultPrevented).toBe(false);
  });
});
