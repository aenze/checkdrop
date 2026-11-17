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

const field = (selector: string, canonical_field: string, mode: "suggest" | "shadow") => ({
  selector,
  canonical_field,
  context: "billing",
  condition_key: null,
  required: false,
  require_complete_name: false,
  validation_mode: mode,
  validation_trigger: mode === "suggest" ? "input" : "blur",
});
const fields = [
  field("#street", "street_line", "suggest"),
  field("#city", "city", "shadow"),
  field("#zip", "postal_code", "shadow"),
  field("#country", "country", "shadow"),
];
const suggestion = {
  id: "1",
  label: "Staniční 733/29, Doubravka, 312 00 Plzeň",
  street_line: "Staniční 733/29",
  city: "Plzeň",
  postal_code: "31200",
};

type Answer = { ok: boolean; body: unknown } | "offline";

async function fixture(scriptSource: string, answer: () => Answer, features?: object) {
  const dom = new JSDOM(
    '<form id="order"><input id="street"><input id="city"><input id="zip"><input id="country" value="CZ"><input id="other"></form>',
    { url: "https://shop.test/kosik", runScripts: "dangerously", pretendToBeVisual: true },
  );
  windows.push(dom);
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/v1/integration/config")
      return {
        ok: true,
        json: async () => ({
          state: "shadow",
          ...(features ? { features } : {}),
          forms: [{ id: "checkout", name: "Checkout", root_selector: "body", fields }],
        }),
      };
    if (path !== "/v1/addresses/autocomplete") return { ok: true, json: async () => ({}) };
    bodies.push(JSON.parse(String(options?.body)));
    const reply = answer();
    if (reply === "offline") throw new Error("offline");
    return { ok: reply.ok, json: async () => reply.body };
  });
  Object.assign(window, { fetch });
  const ready = new Promise<void>((resolve) =>
    window.document.addEventListener("checkdrop:ready", () => resolve(), { once: true }),
  );
  const script = window.document.createElement("script");
  script.dataset.checkdropSite = "test-site";
  script.dataset.checkdropApi = "https://api.test";
  script.textContent = scriptSource;
  window.document.body.append(script);
  await ready;
  const control = (id: string) => window.document.querySelector(`#${id}`) as HTMLInputElement;
  const fill = (id: string, value: string, focus = true) => {
    if (focus) control(id).focus();
    control(id).value = value;
    control(id).dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const leave = (id: string) => {
    control(id).dispatchEvent(new window.Event("change", { bubbles: true }));
    control(id).dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    control("other").focus();
  };
  const panel = () => window.document.querySelector(".checkdrop-address-assist");
  const warning = () => window.document.querySelector(".checkdrop-field-assist-warning");
  return { window, control, fill, leave, panel, warning, bodies };
}

const matched = (advice?: object) => ({
  ok: true,
  body: {
    request_id: REQUEST_ID,
    status: "matched",
    suggestions: [suggestion],
    ...(advice ? { advice } : {}),
  },
});

describe.each(variants)(
  "address assistance with components (%s script)",
  (_variant, scriptSource) => {
    it("sends components only when the config announces them", async () => {
      const announced = await fixture(scriptSource, () => matched(), { address_components: true });
      announced.fill("city", "Plzeň", false);
      announced.fill("zip", "31201", false);
      announced.fill("street", " Staniční 733/29 ");
      await vi.waitFor(() => expect(announced.bodies).toHaveLength(1), { timeout: 1_000 });
      expect(announced.bodies[0]).toEqual({
        query: "Staniční 733/29 Plzeň 31201",
        country: "CZ",
        limit: 5,
        components: { street_line: "Staniční 733/29", city: "Plzeň", postal_code: "31201" },
      });

      const legacy = await fixture(scriptSource, () => matched());
      legacy.fill("street", "Staniční 733/29");
      await vi.waitFor(() => expect(legacy.bodies).toHaveLength(1), { timeout: 1_000 });
      expect(legacy.bodies[0]).not.toHaveProperty("components");
    });

    it("keeps a neutral heading while the customer is typing", async () => {
      const f = await fixture(scriptSource, () => matched(), { address_components: true });
      f.fill("street", "Staniční 733");
      await vi.waitFor(() => expect(f.panel()).not.toBeNull(), { timeout: 1_000 });
      const title = f.panel()?.querySelector(".checkdrop-address-assist-title");
      expect(title?.textContent).toBe("Vyberte adresu");
      expect(title?.classList.contains("checkdrop-address-assist-warning")).toBe(false);
    });

    it("names the right PSČ after leaving the form and fills all three fields on selection", async () => {
      const f = await fixture(
        scriptSource,
        () => matched({ code: "address.postal_code_mismatch", postal_code: "31200" }),
        { address_components: true },
      );
      f.fill("street", "Staniční 733/29", false);
      f.fill("city", "Plzeň", false);
      f.fill("zip", "31201", false);
      f.leave("zip");
      await vi.waitFor(
        () => expect(f.panel()?.textContent).toContain("K této adrese patří PSČ 312 00."),
        { timeout: 1_000 },
      );
      expect(f.control("zip").value).toBe("31201");
      f.panel()
        ?.querySelector<HTMLButtonElement>("button.checkdrop-address-assist-option")
        ?.click();
      expect([f.control("street").value, f.control("city").value, f.control("zip").value]).toEqual([
        "Staniční 733/29",
        "Plzeň",
        "312 00",
      ]);
    });

    it("warns about a missing house number and an unverified address only after blur", async () => {
      const missing = await fixture(
        scriptSource,
        () => ({
          ok: true,
          body: {
            status: "no_match",
            suggestions: [],
            advice: { code: "address.house_number_missing" },
          },
        }),
        { address_components: true },
      );
      missing.fill("street", "Staniční");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(missing.warning()).toBeNull();
      missing.leave("street");
      await vi.waitFor(() =>
        expect(missing.warning()?.textContent).toContain(
          "Doplňte číslo domu, ať se doručení nezpozdí.",
        ),
      );

      const unknown = await fixture(
        scriptSource,
        () => ({
          ok: true,
          body: { status: "no_match", suggestions: [], advice: { code: "address.no_match" } },
        }),
        { address_components: true },
      );
      unknown.fill("street", "Neexistující 9", false);
      unknown.leave("street");
      await vi.waitFor(() =>
        expect(unknown.warning()?.textContent).toContain(
          "Adresu se nepodařilo ověřit. Zkontrolujte ulici, číslo domu a PSČ.",
        ),
      );
    });

    it("shows no address warning when the lookup is unavailable", async () => {
      const f = await fixture(scriptSource, () => "offline", { address_components: true });
      f.fill("street", "Staniční 733/29", false);
      f.leave("street");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(f.warning()).toBeNull();
      expect(f.panel()).toBeNull();
    });

    it("ignores unknown advice codes and malformed postal codes", async () => {
      const f = await fixture(
        scriptSource,
        () => matched({ code: "address.postal_code_mismatch", postal_code: "<b>31200</b>" }),
        { address_components: true },
      );
      f.fill("street", "Staniční 733/29", false);
      f.leave("street");
      await vi.waitFor(() => expect(f.panel()).not.toBeNull(), { timeout: 1_000 });
      expect(f.panel()?.textContent).not.toContain("<b>");
      expect(f.panel()?.textContent).toContain("Doplňte adresu podle nápovědy");
    });
  },
);
