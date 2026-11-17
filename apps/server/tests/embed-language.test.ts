import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});

async function warningOn(lang: string) {
  const dom = new JSDOM(
    `<!doctype html><html lang="${lang}"><body><form><input id="zip"><button class="send" type="button">Order</button></form></body></html>`,
    { url: "https://shop.test/checkout", runScripts: "dangerously", pretendToBeVisual: true },
  );
  windows.push(dom);
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
  const fields = [
    {
      selector: "#zip",
      canonical_field: "postal_code",
      context: "billing",
      condition_key: null,
      required: true,
      require_domestic_address: true,
      submit_selector: ".send",
      validation_mode: "shadow",
      validation_trigger: "blur",
    },
  ];
  Object.assign(window, {
    fetch: vi.fn(async (url: string) =>
      url.includes("/config?")
        ? {
            ok: true,
            json: async () => ({
              state: "shadow",
              forms: [{ id: "f", name: "Checkout", root_selector: "body", fields }],
            }),
          }
        : { ok: true, json: async () => ({}) },
    ),
    AbortSignal,
  });
  const ready = new Promise<void>((resolve) =>
    window.document.addEventListener("checkdrop:ready", () => resolve(), { once: true }),
  );
  const script = window.document.createElement("script");
  script.dataset.checkdropSite = "test-site";
  script.dataset.checkdropApi = "https://api.test";
  script.textContent = CHECKDROP_EMBED_SCRIPT;
  window.document.body.append(script);
  await ready;
  const zip = window.document.querySelector<HTMLInputElement>("#zip");
  if (!zip) throw new Error("missing field");
  zip.value = "841 08";
  zip.dispatchEvent(new window.Event("input", { bubbles: true }));
  zip.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  return window.document.querySelector(".checkdrop-field-assist-copy")?.textContent;
}

describe("hosted script language", () => {
  it("speaks English on an English page of the shop", async () => {
    expect(await warningOn("en-GB")).toBe(
      "This address does not look Czech. We deliver only within Czechia; please check it, otherwise the order may be cancelled.",
    );
  });
  it.each(["cs", "", "de"])("keeps Czech on a page with language %j", async (lang) => {
    expect(await warningOn(lang)).toMatch(/^Adresa nevypadá jako česká/);
  });
});
