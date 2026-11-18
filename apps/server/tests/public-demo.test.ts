import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../../web/src/pages/index.astro", import.meta.url), "utf8");
const script = readFileSync(new URL("../../web/public/frontpage/novy.js", import.meta.url), "utf8");
let dom: JSDOM;

function setup() {
  vi.useFakeTimers();
  dom = new JSDOM(html.replace(/^---[\s\S]*?---/, ""), {
    url: "https://checkdrop.dev/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  Object.assign(w, { AbortSignal, AbortController, fetch: vi.fn() });
  w.eval(script);
  const field = (id: string) => w.document.getElementById(id) as HTMLInputElement;
  const click = (id: string) => (w.document.getElementById(id) as HTMLElement).click();
  const type = (id: string, value: string) => {
    field(id).value = value;
    field(id).dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const status = (row: string) => w.document.querySelector(`#${row} .fstatus`)?.textContent ?? "";
  return { w, field, click, type, status, fetch: vi.mocked(w.fetch) };
}
afterEach(() => {
  dom?.window.close();
  vi.useRealTimers();
});

describe("public demo ownership of user input", () => {
  it("shows the built-in examples without calling the API and applies them only on click", () => {
    const { w, field, click, status, fetch } = setup();
    expect(field("f-email").value).toBe("jan.novak@gmil.com");
    expect(w.document.getElementById("s-email")?.hidden).toBe(false);
    expect(w.document.getElementById("s-email-val")?.textContent).toBe("jan.novak@gmail.com");
    expect(status("row-email")).toBe("Typo in the domain");
    expect(w.document.getElementById("f-count")?.textContent).toBe("2 suggestions to confirm");
    click("s-email-use");
    expect(field("f-email").value).toBe("jan.novak@gmail.com");
    expect(status("row-email")).toBe("Domain accepts mail");
    const option = w.document.querySelector("#s-addr-list button") as HTMLButtonElement;
    expect(option.textContent).toContain("Karlovo náměstí 19/13");
    option.click();
    expect(field("f-street").value).toBe("Karlovo náměstí 19/13");
    expect(field("f-city").value).toBe("Praha 2");
    expect(field("f-zip").value).toBe("120 00");
    expect(w.document.getElementById("f-count")?.textContent).toBe("All confirmed");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps a typo suggestion visible until the customer decides", () => {
    const { w, field, click } = setup();
    click("s-email-keep");
    expect(field("f-email").value).toBe("jan.novak@gmil.com");
    expect(w.document.getElementById("s-email")?.hidden).toBe(true);
  });
  it("asks the demo API for unknown e-mails and only shows the reply", async () => {
    const { w, field, type, click, fetch } = setup();
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "correctable", suggestion: "tester@example.cz" }),
    } as Response);
    type("f-email", "tester@example.com");
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(450);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/public-demo/v1/emails/validate");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "tester@example.com",
      policy: "assist",
    });
    expect(field("f-email").value).toBe("tester@example.com");
    expect(w.document.getElementById("s-email-val")?.textContent).toBe("tester@example.cz");
    click("s-email-use");
    expect(field("f-email").value).toBe("tester@example.cz");
  });
  it("ignores late replies for a value the customer already changed", async () => {
    const { w, field, type, fetch } = setup();
    let finish!: (value: Response) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    type("f-email", "old@example.com");
    await vi.advanceTimersByTimeAsync(450);
    type("f-email", "new@example.com");
    finish({ ok: true, json: async () => ({ suggestion: "old@example.cz" }) } as Response);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.document.getElementById("s-email")?.hidden).toBe(true);
    expect(field("f-email").value).toBe("new@example.com");
  });
  it("preserves input on failures", async () => {
    const { w, field, type, fetch, status } = setup();
    fetch.mockRejectedValueOnce(new Error("Failed to fetch"));
    type("f-email", "tester@example.com");
    await vi.advanceTimersByTimeAsync(450);
    expect(field("f-email").value).toBe("tester@example.com");
    expect(w.document.getElementById("s-email")?.hidden).toBe(true);
    expect(status("row-email")).toBe("No remarks yet");
  });
  it("formats a valid phone only after blur and never calls the API for it", async () => {
    const { w, field, type, status, fetch } = setup();
    type("f-phone", "+420 777 123 456");
    expect(status("row-phone")).toBe("Valid Czech number");
    type("f-phone", "777123456");
    expect(field("f-phone").value).toBe("777123456");
    expect(status("row-phone")).toBe("Will be normalised automatically");
    field("f-phone").dispatchEvent(new w.Event("blur"));
    expect(field("f-phone").value).toBe("+420 777 123 456");
    expect(status("row-phone")).toBe("Format normalised");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("renders live address replies as text and requires choosing one", async () => {
    const { w, field, type, fetch } = setup();
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "matched",
        suggestions: [{ label: "Vodičkova 699/30, 110 00 Praha 1" }, { label: 42 }],
      }),
    } as Response);
    type("f-street", "Vodičkova 30");
    expect(w.document.getElementById("s-addr")?.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(450);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/public-demo/v1/addresses/autocomplete");
    expect(JSON.parse(String(init.body))).toEqual({
      query: "Vodičkova 30",
      country: "CZ",
      limit: 3,
    });
    const options = w.document.querySelectorAll("#s-addr-list button");
    expect(options).toHaveLength(1);
    expect(field("f-street").value).toBe("Vodičkova 30");
    (options[0] as HTMLButtonElement).click();
    expect(field("f-street").value).toBe("Vodičkova 699/30, 110 00 Praha 1");
    expect(w.document.getElementById("s-addr")?.hidden).toBe(true);
  });
});
