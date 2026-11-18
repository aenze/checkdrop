import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});
const name = {
  selector: "#name",
  canonical_field: "full_name",
  context: "billing",
  condition_key: null,
  required: true,
  require_complete_name: true,
  validation_mode: "shadow",
  validation_trigger: "blur",
};
async function fixture(
  fields: object[] = [name],
  html = '<form id="order"><input id="name"><button id="finish" type="submit">Objednat</button><button id="helper" type="submit">Přepočítat</button></form><form id="newsletter"><button type="submit">Odebírat</button></form>',
  apiResult?: object,
  setup?: (window: JSDOM["window"]) => void,
) {
  const dom = new JSDOM(html, {
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
          forms: [{ id: "checkout", name: "Checkout", root_selector: "body", fields }],
        }),
      };
    if (apiResult) return { ok: true, json: async () => apiResult };
    throw new Error("API offline");
  });
  Object.assign(window, { fetch });
  setup?.(window);
  const ready = new Promise<void>((resolve) =>
    window.document.addEventListener("checkdrop:ready", () => resolve(), { once: true }),
  );
  const script = window.document.createElement("script");
  script.dataset.checkdropSite = "test-site";
  script.dataset.checkdropApi = "https://api.test";
  script.textContent = CHECKDROP_EMBED_SCRIPT;
  window.document.body.append(script);
  await ready;
  const input = (selector = "#name") => window.document.querySelector<HTMLInputElement>(selector)!;
  const submit = (selector = "#order", submitter: string | null = "#finish") => {
    const event = new window.SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: submitter ? window.document.querySelector<HTMLButtonElement>(submitter) : null,
    });
    window.document.querySelector(selector)!.dispatchEvent(event);
    return event;
  };
  const edit = (value: string, selector = "#name") => {
    input(selector).value = value;
    input(selector).dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  return { window, input, submit, edit, fetch };
}

async function addressFixture(status: string, street = "Sokolská 134") {
  const fields = [
    ["country", "country"],
    ["street", "street_line"],
    ["city", "city"],
    ["zip", "postal_code"],
  ].map(([selector, canonical_field]) => ({
    ...name,
    selector: `#${selector}`,
    canonical_field,
    require_complete_name: false,
    validation_mode: canonical_field === "street_line" ? "suggest" : "shadow",
  }));
  return fixture(
    fields,
    '<form id="order"><input id="country" value="CZ"><input id="street"><input id="city"><input id="zip"><button id="finish">Objednat</button></form>',
    {
      status,
      suggestions:
        status === "matched"
          ? [
              {
                id: "1",
                label: `${street}, 272 01 Lhota`,
                street_line: street,
                city: "Lhota",
                postal_code: "27201",
              },
            ]
          : [],
    },
  );
}

describe("required name hosted JavaScript", () => {
  it.each(["Jana", "", "RE:START"])(
    "warns for delivery name %j without blocking",
    async (value) => {
      const f = await fixture(
        [
          {
            ...name,
            context: "shipping",
            require_complete_name: false,
            validation_mode: "suggest",
          },
        ],
        undefined,
        { status: "invalid", action: "warn", issues: [{ code: "person.full_name_incomplete" }] },
      );
      f.edit(value);
      f.input().dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
      await vi.waitFor(() =>
        expect(
          Array.from(
            f.window.document.querySelectorAll(
              ".checkdrop-field-assist, .checkdrop-address-assist",
            ),
          )
            .map((element) => element.textContent)
            .join(" "),
        ).toContain("Doplňte jméno i příjmení."),
      );
      expect(f.input().getAttribute("aria-invalid")).toBeNull();
      expect(f.submit().defaultPrevented).toBe(false);
    },
  );

  it.each(["matched", "no_match", "unavailable"])(
    "handles address delay copy for %s",
    async (status) => {
      const f = await addressFixture(status);
      f.edit("Sokols", "#street");
      f.input("#street").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const text = Array.from(
        f.window.document.querySelectorAll(".checkdrop-field-assist, .checkdrop-address-assist"),
      )
        .map((element) => element.textContent)
        .join(" ");
      if (status === "unavailable") {
        expect(text).not.toContain("ať se doručení nezpozdí");
      } else {
        expect(text).toContain("Doplňte adresu podle nápovědy, ať se doručení nezpozdí.");
      }
      if (status === "matched") {
        f.input("#street").dispatchEvent(new f.window.FocusEvent("blur"));
        expect(f.window.document.querySelector(".checkdrop-address-assist")).toBeNull();
        expect(
          f.window.document.querySelector(".checkdrop-field-assist-warning")?.textContent,
        ).toContain("ať se doručení nezpozdí");
      }
      expect(f.submit().defaultPrevented).toBe(false);
    },
  );

  it("does not warn when a manual address already matches, including a village without streets", async () => {
    const f = await addressFixture("matched", "84");
    f.edit("84", "#street");
    f.edit("Lhota", "#city");
    f.edit("27201", "#zip");
    f.input("#street").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      Array.from(
        f.window.document.querySelectorAll(".checkdrop-field-assist, .checkdrop-address-assist"),
      )
        .map((element) => element.textContent)
        .join(" "),
    ).not.toContain("ať se doručení nezpozdí");
    expect(f.input("#street").value).toBe("84");
    expect(f.submit().defaultPrevented).toBe(false);
  });

  it("reminds on an empty active Czech street after blur without waiting for API", async () => {
    const f = await addressFixture("unavailable");
    f.input("#street").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    expect(
      Array.from(
        f.window.document.querySelectorAll(".checkdrop-field-assist, .checkdrop-address-assist"),
      )
        .map((element) => element.textContent)
        .join(" "),
    ).toContain("Doplňte adresu podle nápovědy, ať se doručení nezpozdí.");
    expect(f.submit().defaultPrevented).toBe(false);
    f.edit("Sokolská 134", "#street");
    expect(f.window.document.querySelector(".checkdrop-field-assist-warning")).toBeNull();
  });

  it("keeps an empty-street warning while tabbing through untouched city and postcode", async () => {
    const f = await addressFixture("unavailable");
    f.input("#street").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    for (const selector of ["#city", "#zip"]) {
      f.input(selector).dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
      expect(f.window.document.querySelector(".checkdrop-field-assist-warning")).not.toBeNull();
    }
  });

  it("does not add empty-address reminders to hidden or foreign addresses", async () => {
    const f = await addressFixture("unavailable");
    f.input("#street").hidden = true;
    f.input("#street").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    expect(f.window.document.querySelector(".checkdrop-field-assist-warning")).toBeNull();
    f.input("#street").hidden = false;
    f.edit("SK", "#country");
    f.input("#street").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    expect(f.window.document.querySelector(".checkdrop-field-assist-warning")).toBeNull();
  });

  it("clears a Czech address warning when the customer switches country", async () => {
    const f = await addressFixture("unavailable");
    f.input("#street").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    expect(f.window.document.querySelector(".checkdrop-field-assist-warning")).not.toBeNull();
    f.edit("SK", "#country");
    f.input("#country").dispatchEvent(new f.window.Event("change", { bubbles: true }));
    expect(f.window.document.querySelector(".checkdrop-field-assist-warning")).toBeNull();
  });

  it.each(["hidden", "country", "city"])(
    "ignores a delayed address result after %s changes",
    async (change) => {
      const f = await addressFixture("matched");
      let resolveResult!: (value: object) => void;
      const result = new Promise<object>((resolve) => {
        resolveResult = resolve;
      });
      const originalFetch = f.fetch.getMockImplementation()!;
      f.fetch.mockImplementation(async (url, options) =>
        url.includes("/addresses/autocomplete")
          ? { ok: true, json: () => result }
          : originalFetch(url, options),
      );
      f.edit("Sokols", "#street");
      f.input("#street").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
      if (change === "hidden") f.input("#street").hidden = true;
      else
        f.edit(
          change === "country" ? "SK" : "Jiné město",
          change === "country" ? "#country" : "#city",
        );
      resolveResult({
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
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(f.window.document.querySelector(".checkdrop-address-assist")).toBeNull();
      expect(f.window.document.querySelector(".checkdrop-field-assist-warning")).toBeNull();
    },
  );

  it("links an already queued wholesale purchase on a new page to saved checkout context", async () => {
    const f = await fixture(undefined, undefined, { ok: true }, (window) => {
      Object.assign(window, {
        AbortSignal,
        dataLayer: [
          { event: "purchase_velkoobchod", ecommerce: { transaction_id: "QA-WHOLESALE" } },
        ],
      });
      window.history.replaceState({}, "", "/confirmation");
      window.sessionStorage.setItem(
        "checkdrop:purchase-context:test-site",
        JSON.stringify({ form: "checkout", at: Date.now(), source: "test" }),
      );
    });
    await new Promise((r) => setTimeout(r, 1100));
    const call = f.fetch.mock.calls.find(
      ([url, options]) =>
        url.includes("/checkout/events") && String(options?.body).includes("purchase_reported"),
    );
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      source: "test",
      purchase_channel: "b2b",
      order_ref: "QA-WHOLESALE",
    });
    expect(call?.[0]).toContain("form=checkout");
  });
  it("observes purchase without modifying dataLayer and ignores missing transaction IDs", async () => {
    const f = await fixture();
    Object.assign(f.window, { AbortSignal });
    const layer: object[] = [{ event: "purchase", ecommerce: { transaction_id: "OLD" } }];
    Object.assign(f.window, { dataLayer: layer });
    f.edit("Jan Kovar");
    layer.push({ event: "purchase", ecommerce: {} });
    layer.push({
      event: "purchase",
      ecommerce: { transaction_id: "QA-123", items: [{ secret: "not sent" }] },
      customer_email: "not-sent@example.test",
    });
    await new Promise((r) => setTimeout(r, 1100));
    const calls = f.fetch.mock.calls.filter(
      ([url, options]) =>
        url.includes("/checkout/events") && String(options?.body).includes("purchase_reported"),
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({
      order_ref: "QA-123",
      purchase_channel: "b2c",
    });
    expect(String(calls[0]?.[1]?.body)).not.toContain("not-sent");
    expect(String(calls[0]?.[1]?.body)).not.toContain("secret");
    expect(layer).toHaveLength(3);
  });
  it("records attempts and blocking without values and does not block complete names", async () => {
    const f = await fixture([{ ...name, submit_selector: "#finish" }]);
    Object.assign(f.window, { AbortSignal });
    f.edit("Jan");
    f.submit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const records = () =>
      f.fetch.mock.calls
        .filter(([url]) => url.includes("/checkout/events"))
        .map(([, options]) => JSON.parse(String(options?.body)));
    expect(records().map((e) => e.event)).toEqual(["started", "submit_attempt", "blocked"]);
    expect(records().at(-1).reason).toBe("checkdrop_name");
    expect(JSON.stringify(records())).not.toContain("Jan");
    f.edit("Jan Kovar");
    expect(f.submit().defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(records().at(-1).event).toBe("submit_dispatched");
    expect(records().every((e) => e.source === "customer")).toBe(true);
  });
  it("keeps address undo visible without requerying and never crosses contexts", async () => {
    const fields = [
      { ...name, selector: "#country", canonical_field: "country", require_complete_name: false },
      {
        ...name,
        selector: "#street",
        canonical_field: "street_line",
        require_complete_name: false,
        validation_mode: "suggest",
      },
      { ...name, selector: "#city", canonical_field: "city", require_complete_name: false },
      { ...name, selector: "#zip", canonical_field: "postal_code", require_complete_name: false },
      {
        ...name,
        selector: "#shipping",
        canonical_field: "city",
        context: "shipping",
        require_complete_name: false,
      },
    ];
    const f = await fixture(
      fields,
      '<form id="order"><input id="country" value="CZ"><input id="street"><input id="city"><input id="zip"><input id="shipping" value="Praha"><button id="finish">Objednat</button></form>',
      {
        status: "matched",
        suggestions: [
          {
            id: "1",
            label: "gen. Klapálka 1547, 272 01 Kladno",
            street_line: "gen. Klapálka 1547",
            city: "Kladno",
            postal_code: "27201",
          },
        ],
      },
    );
    f.edit("Generála Klapálka 1547", "#street");
    f.input("#street").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    await vi.waitFor(() =>
      expect(f.window.document.querySelector(".checkdrop-address-assist-option")).not.toBeNull(),
    );
    expect(
      Array.from(
        f.window.document.querySelectorAll(".checkdrop-field-assist, .checkdrop-address-assist"),
      )
        .map((element) => element.textContent)
        .join(" "),
    ).toContain("Doplňte adresu podle nápovědy, ať se doručení nezpozdí.");
    f.window.document.querySelector<HTMLButtonElement>(".checkdrop-address-assist-option")!.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.input("#city").value).toBe("Kladno");
    expect(f.input("#zip").value).toBe("272 01");
    expect(f.input("#shipping").value).toBe("Praha");
    expect(
      f.fetch.mock.calls.filter(([url]) => url.includes("/addresses/autocomplete")),
    ).toHaveLength(1);
    expect(f.window.document.querySelector(".checkdrop-address-assist")).toBeNull();
    expect(
      Array.from(
        f.window.document.querySelectorAll(".checkdrop-field-assist, .checkdrop-address-assist"),
      )
        .map((element) => element.textContent)
        .join(" "),
    ).not.toContain("ať se doručení nezpozdí");
    const undo = f.window.document.querySelector<HTMLButtonElement>(
      ".checkdrop-field-assist-undo",
    )!;
    expect(undo).not.toBeNull();
    f.edit("Ručně změněno", "#city");
    undo.click();
    expect(f.input("#street").value).toBe("Generála Klapálka 1547");
    expect(f.input("#city").value).toBe("Ručně změněno");
    expect(f.input("#zip").value).toBe("");
  });
  it.each(["Opravit", "Ponechat"])(
    "offers cosmetic names without blocking and remembers %s",
    async (choice) => {
      const f = await fixture([{ ...name, validation_mode: "suggest" }], undefined, {
        status: "correctable",
        action: "suggest",
        suggestion: "Jan Kovar",
        issues: [{ code: "person.capitalization_normalized", severity: "info" }],
      });
      f.edit("Jan KOvar");
      f.input().dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
      expect(f.window.document.querySelector(".checkdrop-name-ok")).toBeNull();
      await vi.waitFor(() =>
        expect(f.window.document.querySelector(".checkdrop-field-assist")?.textContent).toContain(
          "Jan Kovar?",
        ),
      );
      expect(f.submit().defaultPrevented).toBe(false);
      const button = Array.from(
        f.window.document.querySelectorAll<HTMLButtonElement>(".checkdrop-field-assist button"),
      ).find((item) => item.textContent === choice);
      expect(button).toBeDefined();
      button?.click();
      expect(f.input().value).toBe(choice === "Opravit" ? "Jan Kovar" : "Jan KOvar");
      expect(f.window.document.querySelector(".checkdrop-name-ok")).not.toBeNull();
      f.input().dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
      expect(f.window.document.querySelector(".checkdrop-name-ok")).not.toBeNull();
      expect(f.window.document.querySelector(".checkdrop-field-assist button")).toBeNull();
      f.edit("Jan");
      expect(f.submit().defaultPrevented).toBe(true);
    },
  );

  it("shows only the suggested email domain but applies the full unchanged local part", async () => {
    const f = await fixture(
      [
        {
          ...name,
          canonical_field: "email",
          require_complete_name: false,
          validation_mode: "suggest",
        },
      ],
      undefined,
      {
        status: "correctable",
        action: "suggest",
        suggestion: "test@seznam.cz",
        issues: [{ code: "email.domain_typo" }],
      },
    );
    f.edit("test@seznan.cz");
    f.input().dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    await vi.waitFor(() =>
      expect(f.window.document.querySelector(".checkdrop-field-assist-copy")?.textContent).toBe(
        "Mysleli jste seznam.cz?",
      ),
    );
    expect(f.input().value).toBe("test@seznan.cz");
    f.window.document.querySelector<HTMLButtonElement>(".checkdrop-field-assist button")?.click();
    expect(f.input().value).toBe("test@seznam.cz");
  });
  it("does not let an async response erase the other split field's local error", async () => {
    const f = await fixture(
      [
        { ...name, canonical_field: "first_name", validation_mode: "suggest" },
        { ...name, selector: "#last", canonical_field: "last_name", validation_mode: "suggest" },
      ],
      '<form id="order"><input id="name" value="Jana"><input id="last" value="N."><button id="finish">Objednat</button></form>',
      { status: "valid", action: "accept", issues: [] },
    );
    f.input().dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    expect(f.submit().defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(f.fetch.mock.calls.length).toBeGreaterThan(1));
    expect(f.input("#last").getAttribute("aria-invalid")).toBe("true");
    expect(
      f.window.document.querySelector(".checkdrop-field-assist-warning")?.textContent,
    ).toContain("Doplňte");
  });
  it("blocks before the shop handler, then unblocks immediately with no confirmation or API", async () => {
    const f = await fixture();
    const sent = vi.fn();
    f.window.document.querySelector("#order")!.addEventListener("submit", sent);
    f.edit("Jana");
    expect(f.submit().defaultPrevented).toBe(true);
    expect(sent).not.toHaveBeenCalled();
    expect(f.input().getAttribute("aria-invalid")).toBe("true");
    expect(f.window.document.activeElement).toBe(f.input());
    f.edit("Jana Nováková");
    expect(f.input().hasAttribute("aria-invalid")).toBe(false);
    expect(f.window.document.querySelectorAll(".checkdrop-name-ok")).toHaveLength(1);
    expect(f.window.document.querySelectorAll(".checkdrop-field-assist button")).toHaveLength(0);
    expect(f.submit().defaultPrevented).toBe(false);
    expect(sent).toHaveBeenCalledOnce();
  });
  it("covers Enter/requestSubmit events without touching newsletter or helper submits", async () => {
    const f = await fixture([{ ...name, submit_selector: "#finish" }]);
    expect(f.submit("#newsletter", null).defaultPrevented).toBe(false);
    expect(f.submit("#order", "#helper").defaultPrevented).toBe(false);
    expect(f.submit("#order", null).defaultPrevented).toBe(true);
  });
  it("intercepts AJAX final clicks before delegated shop handlers", async () => {
    const f = await fixture(
      [{ ...name, submit_selector: ".register" }],
      '<form id="order"><input id="name"><button class="register" type="button"><span id="icon">Registrovat</span></button></form>',
    );
    const ajax = vi.fn();
    f.window.document.addEventListener("click", ajax);
    f.window.document.querySelector<HTMLElement>("#icon")!.click();
    expect(ajax).not.toHaveBeenCalled();
    f.edit("Jana Nováková");
    f.window.document.querySelector<HTMLElement>("#icon")!.click();
    expect(ajax).toHaveBeenCalledOnce();
  });
  it("ignores inactive business-person, disabled and hidden fields", async () => {
    const f = await fixture(
      [
        { ...name, condition_key: "customer_type=private" },
        {
          ...name,
          selector: "#type",
          canonical_field: "customer_type",
          require_complete_name: false,
        },
      ],
      '<form id="order"><select id="type"><option value="company">Firma</option><option value="private">Soukromě</option></select><input id="name"><button id="finish">Objednat</button></form>',
    );
    expect(f.submit().defaultPrevented).toBe(false);
    f.window.document.querySelector<HTMLSelectElement>("#type")!.value = "private";
    expect(f.submit().defaultPrevented).toBe(true);
    f.input().disabled = true;
    expect(f.submit().defaultPrevented).toBe(false);
    expect(f.input().hasAttribute("aria-invalid")).toBe(false);
    f.input().disabled = false;
    f.input().hidden = true;
    expect(f.submit().defaultPrevented).toBe(false);
  });
  it("requires both split fields and keeps billing and shipping separate", async () => {
    const f = await fixture(
      [
        { ...name, selector: "#name", canonical_field: "first_name" },
        { ...name, selector: "#last", canonical_field: "last_name" },
        { ...name, selector: "#shipping", context: "shipping" },
      ],
      '<form id="order"><input id="name" value="Jana"><input id="last"><input id="shipping" value="Eva Nová"><button id="finish">Objednat</button></form>',
    );
    expect(f.submit().defaultPrevented).toBe(true);
    f.edit("Nováková", "#last");
    expect(f.submit().defaultPrevented).toBe(false);
    f.edit("Eva", "#shipping");
    expect(f.submit().defaultPrevented).toBe(true);
    expect(f.window.document.activeElement).toBe(f.input("#shipping"));
  });
  it("accepts a person or company as a company delivery recipient", async () => {
    const customerType = {
      ...name,
      selector: 'input[name="is_company"]',
      canonical_field: "customer_type",
      context: "shared",
      require_complete_name: false,
      validation_mode: "shadow" as const,
      validation_trigger: "input" as const,
    };
    const delivery = {
      ...name,
      selector: "#shipping",
      context: "shipping",
      validation_mode: "suggest" as const,
    };
    const f = await fixture(
      [customerType, delivery],
      '<form id="order"><input id="company" type="radio" name="is_company" value="company" checked><label for="company">Firma</label><input id="private" type="radio" name="is_company" value="private"><label for="private">Soukromě</label><input id="shipping" value="RE:START"><button id="finish">Objednat</button></form>',
    );

    expect(f.submit().defaultPrevented).toBe(false);
    f.input("#shipping").dispatchEvent(new f.window.FocusEvent("focusout", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      f.fetch.mock.calls.filter(([url]) => String(url).includes("/v1/names/validate")),
    ).toHaveLength(0);
    expect(f.input("#shipping").getAttribute("aria-invalid")).toBeNull();
    expect(f.window.document.querySelector(".checkdrop-field-assist-warning")).toBeNull();

    f.edit("", "#shipping");
    expect(f.submit().defaultPrevented).toBe(true);

    f.edit("Jana Nováková", "#shipping");
    expect(f.submit().defaultPrevented).toBe(false);
  });
  it("still requires a personal delivery name for private buyers", async () => {
    const f = await fixture(
      [
        {
          ...name,
          selector: 'input[name="is_company"]',
          canonical_field: "customer_type",
          context: "shared",
          require_complete_name: false,
          validation_trigger: "input",
        },
        { ...name, selector: "#shipping", context: "shipping" },
      ],
      '<form id="order"><input id="private" type="radio" name="is_company" value="private" checked><label for="private">Soukromě</label><input id="company" type="radio" name="is_company" value="company"><label for="company">Firma</label><input id="shipping" value="RE:START"><button id="finish">Objednat</button></form>',
    );

    expect(f.submit().defaultPrevented).toBe(true);
    expect(f.input("#shipping").getAttribute("aria-invalid")).toBe("true");
    f.input("#private").checked = false;
    f.input("#company").checked = true;
    f.input("#company").dispatchEvent(new f.window.Event("input", { bubbles: true }));
    expect(f.input("#shipping").getAttribute("aria-invalid")).toBeNull();
    expect(f.submit().defaultPrevented).toBe(false);
    f.input("#company").checked = false;
    f.input("#private").checked = true;
    f.input("#private").dispatchEvent(new f.window.Event("input", { bubbles: true }));
    f.edit("Jana Nováková", "#shipping");
    expect(f.submit().defaultPrevented).toBe(false);
  });
  it("keeps a company contact person personal", async () => {
    const f = await fixture(
      [
        {
          ...name,
          selector: "#type",
          canonical_field: "customer_type",
          context: "shared",
          require_complete_name: false,
          validation_trigger: "input",
        },
        {
          ...name,
          selector: "#contact",
          context: "shared",
          condition_key: "customer_type=company",
        },
      ],
      '<form id="order"><select id="type"><option value="company">Firma</option></select><input id="contact" value="RE:START"><button id="finish">Objednat</button></form>',
    );

    expect(f.submit().defaultPrevented).toBe(true);
    f.edit("Jan Novák", "#contact");
    expect(f.submit().defaultPrevented).toBe(false);
  });
  it("preserves legacy nonblocking configuration and handles dynamic fields", async () => {
    const legacy = await fixture([{ ...name, require_complete_name: false }]);
    expect(legacy.submit().defaultPrevented).toBe(false);
    const f = await fixture();
    f.input().remove();
    expect(f.submit().defaultPrevented).toBe(false);
    f.window.document
      .querySelector("#order")!
      .insertAdjacentHTML("afterbegin", '<input id="name" value="Jana">');
    expect(f.submit().defaultPrevented).toBe(true);
  });
});
