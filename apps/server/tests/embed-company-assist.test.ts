import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});

const field = (selector: string, canonical: string, mode: "suggest" | "shadow") => ({
  selector,
  canonical_field: canonical,
  context: "company",
  condition_key: null,
  required: false,
  require_complete_name: false,
  validation_mode: mode,
  validation_trigger: "input",
});
const fields = [
  field("#ico", "company_id", "suggest"),
  field("#company", "company_name", "suggest"),
  field("#street", "street_line", "shadow"),
  field("#city", "city", "shadow"),
  field("#zip", "postal_code", "shadow"),
];
const company = {
  ico: "28371003",
  name: "ECOZZ s.r.o.",
  vat_id: "CZ28371003",
  address: "Moskevská 1842, 27204 Kladno",
  registered_office: {
    street_line: "Moskevská 1842",
    city: "Kladno",
    postal_code: "27204",
    country: "CZ",
  },
};
const confirmed = { status: "valid", action: "accept", issues: [], evidence: [], company };
const matched = { status: "matched", suggestions: [company] };

async function fixture(autocomplete: () => Promise<object> = async () => matched) {
  const dom = new JSDOM(
    '<form id="inquiry"><input id="ico"><input id="company"><input id="street"><input id="city"><input id="zip"></form>',
    { url: "https://web.test/poptavka", runScripts: "dangerously", pretendToBeVisual: true },
  );
  windows.push(dom);
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("/config?"))
      return {
        ok: true,
        json: async () => ({
          state: "shadow",
          forms: [{ id: "inquiry", name: "Poptávka", root_selector: "body", fields }],
        }),
      };
    if (url.includes("/companies/autocomplete")) {
      const body = await autocomplete();
      return { ok: true, json: async () => body };
    }
    if (url.includes("/company-ids/validate")) return { ok: true, json: async () => confirmed };
    return { ok: true, json: async () => ({}) };
  });
  Object.assign(window, { fetch });
  const ready = new Promise<void>((resolve) =>
    window.document.addEventListener("checkdrop:ready", () => resolve(), { once: true }),
  );
  const script = window.document.createElement("script");
  script.dataset.checkdropSite = "test-site";
  script.dataset.checkdropApi = "https://api.test";
  script.textContent = CHECKDROP_EMBED_SCRIPT;
  window.document.body.append(script);
  await ready;
  const input = (selector: string) => window.document.querySelector<HTMLInputElement>(selector)!;
  const edit = (value: string, selector = "#ico") => {
    input(selector).focus();
    input(selector).value = value;
    input(selector).dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const assists = () =>
    [...window.document.querySelectorAll(".checkdrop-field-assist, .checkdrop-address-assist")].map(
      (element) => element.textContent?.trim() ?? "",
    );
  return { window, input, edit, assists, fetch };
}

describe("company details from ARES in the form", () => {
  it("fills empty company fields and says so", async () => {
    const f = await fixture();
    f.edit("28371003");
    await vi.waitFor(() => expect(f.assists().join()).toContain("Firemní údaje doplněny z ARES"));
    expect(f.input("#company").value).toBe("ECOZZ s.r.o.");
    expect(f.input("#city").value).toBe("Kladno");
  });

  it("confirms the company when the form already matches the register", async () => {
    const f = await fixture();
    f.input("#company").value = "ECOZZ s.r.o.";
    f.input("#street").value = "Moskevská 1842";
    f.input("#city").value = "Kladno";
    f.input("#zip").value = "272 04";
    f.edit("28371003");
    await vi.waitFor(() => expect(f.assists()).toEqual(["✓Údaje firmy odpovídají ARES"]));
  });

  it("does not let a slower answer for a shorter IČO cover the finished one", async () => {
    let release: (() => void) | undefined;
    const late = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(async () => {
      await late;
      return matched;
    });
    f.edit("2837100");
    await vi.waitFor(() =>
      expect(f.fetch.mock.calls.some(([url]) => String(url).includes("autocomplete"))).toBe(true),
    );
    f.edit("28371003");
    await vi.waitFor(() => expect(f.assists().join()).toContain("Firemní údaje doplněny z ARES"));
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.assists().join()).not.toContain("Vyberte firmu");
  });
});
