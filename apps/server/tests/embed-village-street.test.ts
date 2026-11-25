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

type Context = "billing" | "shipping";
const addressFields = (context: Context, fillVillageStreet: boolean, prefix = "") => [
  {
    selector: `#${prefix}street`,
    canonical_field: "street_line",
    context,
    condition_key: null,
    required: false,
    fill_village_street: fillVillageStreet,
    validation_mode: "suggest",
    validation_trigger: "input",
  },
  ...["city", "postal_code", "country"].map((canonical_field) => ({
    selector: `#${prefix}${canonical_field === "postal_code" ? "zip" : canonical_field}`,
    canonical_field,
    context,
    condition_key: null,
    required: false,
    validation_mode: "shadow",
    validation_trigger: "blur",
  })),
];

const villageSuggestion = {
  id: "sudomerice-242",
  label: "Sudoměřice 242, 696 66 Sudoměřice",
  street_line: "242",
  village_street_line: "Sudoměřice 242",
  street: null,
  city: "Sudoměřice",
  city_part: "Sudoměřice",
  postal_code: "69666",
};

/** What the API answers for Sudoměřice; anything else is an ordinary miss. */
function sudomericeAnswer(body: { components?: { street_line: string; city: string } }) {
  const street = body.components?.street_line ?? "";
  const city = body.components?.city ?? "";
  if (city !== "Sudoměřice") return { status: "no_match", suggestions: [] };
  const bare = street.match(/^(?:č\.\s*p\.\s*)?(242)(\/\d+|[a-z])?$/i);
  return {
    request_id: REQUEST_ID,
    status: "matched",
    suggestions: [villageSuggestion],
    ...(bare
      ? {
          advice: { code: "address.village_street", street_line: `Sudoměřice 242${bare[2] ?? ""}` },
        }
      : {}),
  };
}

async function fixture(
  scriptSource: string,
  fields: readonly object[],
  answer: (body: Record<string, unknown>) => unknown = sudomericeAnswer,
) {
  const dom = new JSDOM(
    `<form id="order">
       <input id="street"><input id="city"><input id="zip"><input id="country" value="CZ">
       <input id="d-street"><input id="d-city"><input id="d-zip"><input id="d-country" value="CZ">
       <input id="other">
     </form>`,
    { url: "https://shop.test/kosik", runScripts: "dangerously", pretendToBeVisual: true },
  );
  windows.push(dom);
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
  const bodies: Record<string, unknown>[] = [];
  const interactions: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/v1/integration/config")
      return {
        ok: true,
        json: async () => ({
          state: "shadow",
          features: { address_components: true },
          forms: [{ id: "checkout", name: "Checkout", root_selector: "body", fields }],
        }),
      };
    if (path === "/v1/assist/interactions") {
      interactions.push(JSON.parse(String(options?.body)));
      return { ok: true, json: async () => ({}) };
    }
    if (path !== "/v1/addresses/autocomplete") return { ok: true, json: async () => ({}) };
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    bodies.push(body);
    const reply = answer(body);
    return { ok: true, json: async () => reply };
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
  const applied = () => window.document.querySelector(".checkdrop-field-assist-applied");
  const panel = () => window.document.querySelector(".checkdrop-address-assist");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 350));
  return { window, control, fill, leave, applied, panel, settle, bodies, interactions };
}

describe.each(variants)("village street completion (%s script)", (_variant, scriptSource) => {
  it("completes a bare number after leaving the street and offers undo", async () => {
    const f = await fixture(scriptSource, addressFields("billing", true));
    f.fill("city", "Sudoměřice", false);
    f.fill("zip", "696 66", false);
    f.fill("street", "242");
    await vi.waitFor(() => expect(f.bodies.length).toBeGreaterThan(0), { timeout: 1_000 });
    await f.settle();
    // While the customer is still typing, nothing changes.
    expect(f.control("street").value).toBe("242");
    expect(f.applied()).toBeNull();

    f.leave("street");
    await vi.waitFor(() => expect(f.control("street").value).toBe("Sudoměřice 242"));
    expect(f.applied()?.textContent).toContain(
      "Upravili jsme ulici na Sudoměřice 242 (obec nemá ulice).",
    );
    expect(f.applied()?.querySelector("strong")?.textContent).toBe("Sudoměřice 242");
    const undo = f.applied()?.querySelector<HTMLButtonElement>("button");
    expect(undo?.textContent).toBe("Vrátit zpět");
    expect(undo?.getAttribute("aria-label")).toBe("Vrátit ulici na 242");
    await vi.waitFor(() =>
      expect(f.interactions.map((event) => event.event)).toEqual(["shown", "applied"]),
    );
    expect(f.interactions[1]).toMatchObject({
      proposed_value: "Sudoměřice 242",
      changed_fields: ["street_line"],
    });

    undo?.click();
    expect(f.control("street").value).toBe("242");
    expect(f.applied()).toBeNull();
    await vi.waitFor(() => expect(f.interactions.at(-1)?.event).toBe("undone"));

    // The customer's choice stays, even after the street is checked again.
    f.control("street").focus();
    f.leave("street");
    await f.settle();
    expect(f.control("street").value).toBe("242");
  });

  it("keeps a slash or a letter the customer typed", async () => {
    const f = await fixture(scriptSource, addressFields("billing", true));
    f.fill("city", "Sudoměřice", false);
    f.fill("street", "242/3", false);
    await vi.waitFor(() => expect(f.control("street").value).toBe("Sudoměřice 242/3"));
  });

  it("works on the delivery address too", async () => {
    const f = await fixture(scriptSource, addressFields("shipping", true, "d-"));
    f.fill("d-city", "Sudoměřice", false);
    f.fill("d-street", "č. p. 242", false);
    await vi.waitFor(() => expect(f.control("d-street").value).toBe("Sudoměřice 242"));
    expect(f.control("street").value).toBe("");
  });

  it("changes nothing when the option is off", async () => {
    const f = await fixture(scriptSource, addressFields("billing", false));
    f.fill("city", "Sudoměřice", false);
    f.fill("street", "242");
    f.leave("street");
    await vi.waitFor(() => expect(f.panel()).not.toBeNull(), { timeout: 1_000 });
    await f.settle();
    expect(f.control("street").value).toBe("242");
    expect(f.applied()).toBeNull();
    expect(f.interactions.map((event) => event.event)).not.toContain("applied");
  });

  it("does nothing without the advice: ambiguous number or a municipality with streets", async () => {
    const f = await fixture(scriptSource, addressFields("billing", true), () => ({
      request_id: REQUEST_ID,
      status: "matched",
      suggestions: [villageSuggestion, { ...villageSuggestion, id: "other" }],
    }));
    f.fill("city", "Sudoměřice", false);
    f.fill("street", "242", false);
    await vi.waitFor(() => expect(f.panel()).not.toBeNull(), { timeout: 1_000 });
    expect(f.control("street").value).toBe("242");
    expect(f.applied()).toBeNull();
  });

  it("ignores advice that does not keep the typed number", async () => {
    const f = await fixture(scriptSource, addressFields("billing", true), () => ({
      request_id: REQUEST_ID,
      status: "matched",
      suggestions: [villageSuggestion],
      advice: { code: "address.village_street", street_line: "Sudoměřice 999" },
    }));
    f.fill("city", "Sudoměřice", false);
    f.fill("street", "242", false);
    await vi.waitFor(() => expect(f.panel()).not.toBeNull(), { timeout: 1_000 });
    expect(f.control("street").value).toBe("242");
  });

  it("waits while the city is being typed and completes after leaving it", async () => {
    const f = await fixture(scriptSource, addressFields("billing", true));
    f.fill("street", "242", false);
    f.fill("city", "Sudoměřice");
    // Shoptet-like configs check the street again when the city changes.
    await f.settle();
    expect(f.control("street").value).toBe("242");
    f.leave("city");
    await vi.waitFor(() => expect(f.control("street").value).toBe("Sudoměřice 242"));

    // Shoptet asks for the PSČ after the city; typing it keeps the note and its undo.
    f.fill("zip", "69666");
    f.leave("zip");
    await f.settle();
    expect(f.control("street").value).toBe("Sudoměřice 242");
    expect(f.applied()?.textContent).toContain("Upravili jsme ulici na Sudoměřice 242");

    // Editing the street itself removes the note.
    f.fill("street", "Sudoměřice 24");
    expect(f.applied()).toBeNull();
  });

  it("fills the village line when the customer picks the suggestion", async () => {
    const f = await fixture(scriptSource, addressFields("billing", true), (body) => ({
      ...sudomericeAnswer(body as never),
      advice: undefined,
    }));
    f.fill("city", "Sudoměřice", false);
    f.fill("street", "24");
    await vi.waitFor(() => expect(f.panel()).not.toBeNull(), { timeout: 1_000 });
    f.panel()?.querySelector<HTMLButtonElement>("button.checkdrop-address-assist-option")?.click();
    expect(f.control("street").value).toBe("Sudoměřice 242");
    expect(f.control("zip").value).toBe("696 66");
  });

  it("accepts the official form as typed, even without the option", async () => {
    const f = await fixture(scriptSource, addressFields("billing", false), (body) => ({
      ...sudomericeAnswer(body as never),
      advice: undefined,
    }));
    f.fill("city", "Sudoměřice", false);
    f.fill("zip", "69666", false);
    f.fill("street", "Sudoměřice 242", false);
    f.leave("street");
    await vi.waitFor(() => expect(f.bodies.length).toBeGreaterThan(0), { timeout: 1_000 });
    await f.settle();
    expect(f.panel()).toBeNull();
    expect(f.control("street").value).toBe("Sudoměřice 242");
  });
});
