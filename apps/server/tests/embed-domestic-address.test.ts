import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

const warningText =
  "Adresa nevypadá jako česká. Doručujeme jen v ČR, zkontrolujte ji, jinak může být objednávka stornována.";
const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});

const base = {
  condition_key: null,
  required: true,
  validation_mode: "shadow",
  validation_trigger: "blur",
};
function addressFields(context: "billing" | "shipping", prefix: string, guarded = true) {
  return [
    {
      ...base,
      selector: `#${prefix}street`,
      canonical_field: "street_line",
      context,
      validation_mode: "suggest",
      validation_trigger: "input",
    },
    { ...base, selector: `#${prefix}city`, canonical_field: "city", context },
    {
      ...base,
      selector: `#${prefix}zip`,
      canonical_field: "postal_code",
      context,
      ...(guarded ? { require_domestic_address: true, submit_selector: ".send" } : {}),
    },
    {
      ...base,
      selector: `#${prefix}country`,
      canonical_field: "country",
      context,
      validation_trigger: "submit",
    },
  ];
}
const addressHtml = (prefix: string) =>
  `<input id="${prefix}street"><input id="${prefix}city"><input id="${prefix}zip"><select id="${prefix}country"><option value="1">Česká republika</option><option value="2">Slovensko</option></select>`;
const checkoutHtml = `<form id="order">${addressHtml("")}<div id="delivery" hidden>${addressHtml("d-")}</div><input id="name"><button class="send" type="button"><span id="icon">Objednat</span></button></form>`;

async function fixture(
  fields: object[] = [...addressFields("billing", ""), ...addressFields("shipping", "d-")],
  addressResult: object = { status: "no_match", suggestions: [] },
) {
  const dom = new JSDOM(checkoutHtml, {
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
    if (url.includes("/config?"))
      return {
        ok: true,
        json: async () => ({
          state: "shadow",
          features: { address_components: true },
          forms: [{ id: "checkout", name: "Checkout", root_selector: "body", fields }],
        }),
      };
    if (url.includes("/addresses/autocomplete"))
      return { ok: true, json: async () => addressResult };
    return { ok: true, json: async () => ({}) };
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
  await ready;
  const element = <T extends Element>(selector: string) => {
    const found = window.document.querySelector<T>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };
  const control = (selector: string) => element<HTMLInputElement | HTMLSelectElement>(selector);
  const type = (selector: string, value: string) => {
    control(selector).value = value;
    control(selector).dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const leave = (selector: string) =>
    control(selector).dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  const fill = (street: string, city: string, zip: string, prefix = "") => {
    for (const [field, value] of [
      ["street", street],
      ["city", city],
      ["zip", zip],
    ] as const) {
      type(`#${prefix}${field}`, value);
      leave(`#${prefix}${field}`);
    }
  };
  const ajax = vi.fn();
  window.document.addEventListener("click", ajax);
  const finish = () => element<HTMLElement>("#icon").click();
  const warningAfter = (selector: string) => {
    const next = control(selector).nextElementSibling;
    return next?.classList.contains("checkdrop-field-assist")
      ? (next.querySelector(".checkdrop-field-assist-copy")?.textContent ?? null)
      : null;
  };
  const warnings = () =>
    Array.from(
      window.document.querySelectorAll(
        ".checkdrop-field-assist-warning .checkdrop-field-assist-copy",
      ),
    ).map((element) => element.textContent);
  const records = () =>
    fetch.mock.calls
      .filter(([url]) => url.includes("/checkout/events"))
      .map(([, options]) => JSON.parse(String(options?.body)));
  return {
    window,
    control,
    type,
    leave,
    fill,
    finish,
    ajax,
    warningAfter,
    warnings,
    records,
    fetch,
  };
}

describe("domestic-only delivery hosted JavaScript", () => {
  it("points out a Slovak PSČ on leaving the field and removes it once corrected", async () => {
    const f = await fixture();
    f.type("#zip", "841 08");
    expect(f.warningAfter("#zip")).toBeNull();
    f.leave("#zip");
    expect(f.warningAfter("#zip")).toBe(warningText);
    f.type("#zip", "110 00");
    expect(f.warningAfter("#zip")).toBeNull();
  });

  it("stops the final click once for the same address and records it without values", async () => {
    const f = await fixture();
    f.fill("Jonáša 4", "Bratislava", "84108");
    f.finish();
    expect(f.ajax).not.toHaveBeenCalled();
    expect(f.window.document.activeElement).toBe(f.control("#zip"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const blocked = f.records().filter((record) => record.event === "blocked");
    expect(blocked).toEqual([
      expect.objectContaining({
        reason: "checkdrop_foreign_address",
        field: "postal_code",
        context: "billing",
      }),
    ]);
    // Whole tokens only: a random event_id may contain "841" by chance.
    expect(JSON.stringify(f.records())).not.toMatch(/Bratislava|\b841 ?08\b|Jonáša/);
    f.finish();
    expect(f.ajax).toHaveBeenCalledOnce();
    expect(f.warningAfter("#zip")).toBe(warningText);
  });

  it("stops again once when the customer changes to another foreign address", async () => {
    const f = await fixture();
    f.fill("Hlavná 12", "Topoľčany", "955 01");
    f.finish();
    f.finish();
    expect(f.ajax).toHaveBeenCalledOnce();
    f.fill("Jonáša 4", "Bratislava", "841 08");
    f.finish();
    expect(f.ajax).toHaveBeenCalledOnce();
    f.finish();
    expect(f.ajax).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["Bratislavská 12/3", "Břeclav", "690 02"],
    ["Trnava 12", "Trnava", "763 18"],
    ["Lipová 5", "Skalice u České Lípy", "471 17"],
  ])("never stops a Czech address such as %s, %s", async (street, city, zip) => {
    const f = await fixture();
    f.fill(street, city, zip);
    f.finish();
    expect(f.ajax).toHaveBeenCalledOnce();
    expect(f.warnings()).toEqual([]);
  });

  it("warns at the town when only the town is clearly Slovak", async () => {
    const f = await fixture();
    f.type("#city", "Šaľa");
    f.leave("#city");
    expect(f.warningAfter("#city")).toBe(warningText);
    expect(f.warningAfter("#zip")).toBeNull();
  });

  it("warns when Slovakia is chosen as the country", async () => {
    const f = await fixture();
    f.fill("Hlavná 12", "Senica", "");
    f.control("#country").value = "2";
    f.control("#country").dispatchEvent(new f.window.Event("change", { bubbles: true }));
    expect(f.warningAfter("#country")).toBe(warningText);
  });

  it("ignores a hidden delivery address and checks it once it is shown", async () => {
    const f = await fixture();
    f.fill("Ostrovní 2", "Praha 1", "110 00");
    f.control("#d-zip").value = "841 08";
    f.finish();
    expect(f.ajax).toHaveBeenCalledOnce();
    f.control("#d-zip").closest("#delivery")?.removeAttribute("hidden");
    f.finish();
    expect(f.ajax).toHaveBeenCalledOnce();
    expect(f.warningAfter("#d-zip")).toBe(warningText);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.records().at(-1)).toMatchObject({
      event: "blocked",
      reason: "checkdrop_foreign_address",
      context: "shipping",
    });
  });

  it("leaves shops without the setting unchanged", async () => {
    const f = await fixture([
      ...addressFields("billing", "", false),
      ...addressFields("shipping", "d-", false),
    ]);
    f.fill("Jonáša 4", "Bratislava", "841 08");
    f.finish();
    expect(f.ajax).toHaveBeenCalledOnce();
    expect(f.warningAfter("#zip")).toBeNull();
  });

  it("keeps the street quiet on a country mismatch when the PSČ carries the warning", async () => {
    const mismatch = {
      status: "no_match",
      advice: { code: "address.country_mismatch" },
      suggestions: [],
    };
    const f = await fixture(undefined, mismatch);
    f.fill("Jonáša 4", "Bratislava", "841 08");
    await vi.waitFor(() =>
      expect(f.fetch.mock.calls.some(([url]) => url.includes("/addresses/autocomplete"))).toBe(
        true,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.warnings()).toEqual([warningText]);

    const plain = await fixture(
      [...addressFields("billing", "", false), ...addressFields("shipping", "d-", false)],
      mismatch,
    );
    plain.type("#zip", "841 08");
    plain.type("#city", "Bratislava");
    plain.type("#street", "Jonáša 4");
    plain.leave("#street");
    await vi.waitFor(() =>
      expect(plain.warningAfter("#street")).toBe(
        "Adresu se nepodařilo ověřit. Zkontrolujte ulici, číslo domu a PSČ.",
      ),
    );
  });

  it("asks for the full name first and points out the address on the next click", async () => {
    const f = await fixture([
      ...addressFields("billing", ""),
      {
        ...base,
        selector: "#name",
        canonical_field: "full_name",
        context: "billing",
        require_complete_name: true,
        submit_selector: ".send",
      },
    ]);
    f.fill("Jonáša 4", "Bratislava", "841 08");
    f.type("#name", "Jana");
    f.finish();
    expect(f.window.document.activeElement).toBe(f.control("#name"));
    f.type("#name", "Jana Nováková");
    f.finish();
    expect(f.ajax).not.toHaveBeenCalled();
    expect(f.window.document.activeElement).toBe(f.control("#zip"));
    f.finish();
    expect(f.ajax).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      f
        .records()
        .filter((record) => record.event === "blocked")
        .map((record) => record.reason),
    ).toEqual(["checkdrop_name", "checkdrop_foreign_address"]);
  });
});
