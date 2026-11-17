import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

const loader = readFileSync(
  new URL("../../../integrations/wordpress/checkdrop/loader.js", import.meta.url),
  "utf8",
);
const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});
function fixture() {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://independent-shop.test/",
    runScripts: "dangerously",
  });
  windows.push(dom);
  return dom.window;
}
function load(window: JSDOM["window"], key: string, server?: string) {
  const script = window.document.createElement("script");
  script.setAttribute("data-checkdrop-wordpress-site", key);
  if (server !== undefined) script.setAttribute("data-checkdrop-wordpress-server", server);
  script.textContent = loader;
  window.document.body.append(script);
}
describe("universal WordPress loader", () => {
  it("inserts exactly one trusted embed with only the public key", () => {
    const window = fixture();
    load(window, "cdp_site_shop-123");
    load(window, "cdp_site_shop-123");
    const embeds = window.document.querySelectorAll<HTMLScriptElement>(
      "script[data-checkdrop-site]",
    );
    expect(embeds).toHaveLength(1);
    expect(embeds[0]?.src).toBe("https://api.checkdrop.dev/v1/embed.js");
    expect(embeds[0]?.async).toBe(true);
    expect(embeds[0]?.dataset.checkdropSite).toBe("cdp_site_shop-123");
  });
  it("loads the embed from a self-hosted installation when the site sets one", () => {
    const window = fixture();
    load(window, "cdp_site_shop-123", "https://checks.example.com");
    expect(
      window.document.querySelector<HTMLScriptElement>("script[data-checkdrop-site]")?.src,
    ).toBe("https://checks.example.com/v1/embed.js");
  });
  it.each([
    "http://checks.example.com",
    "https://checks.example.com/path",
    "javascript:alert(1)",
    "nonsense",
  ])("refuses the unsafe server %s instead of falling back to another one", (server) => {
    const window = fixture();
    load(window, "cdp_site_shop-123", server);
    expect(window.document.querySelector("script[data-checkdrop-site]")).toBeNull();
  });
  it("preserves an existing manual integration without inserting another", () => {
    const window = fixture();
    const manual = window.document.createElement("script");
    manual.setAttribute("data-checkdrop-site", "cdp_site_manual");
    window.document.head.append(manual);
    load(window, "cdp_site_plugin");
    expect(window.document.querySelectorAll("script[data-checkdrop-site]")).toHaveLength(1);
  });
  it.each(["", "private-secret", 'cdp_site_"><script>', "cdp_site_a"])(
    "ignores invalid key %s",
    (key) => {
      const window = fixture();
      load(window, key);
      expect(window.document.querySelector("script[data-checkdrop-site]")).toBeNull();
    },
  );
  it("runtime does not register twice when a later GTM snippet executes", async () => {
    const window = fixture();
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ state: "paused" }) }));
    Object.assign(window, { fetch });
    for (let index = 0; index < 2; index++) {
      const script = window.document.createElement("script");
      script.dataset.checkdropSite = "cdp_site_shop-123";
      script.dataset.checkdropApi = "https://api.checkdrop.dev";
      script.textContent = CHECKDROP_EMBED_SCRIPT;
      window.document.body.append(script);
    }
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
