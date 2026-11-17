import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../pages/index.astro", import.meta.url), "utf8");
const czech = readFileSync(new URL("../pages/cs/index.astro", import.meta.url), "utf8");
const developers = readFileSync(new URL("../pages/developers.astro", import.meta.url), "utf8");
const vyvojari = readFileSync(new URL("../pages/cs/vyvojari.astro", import.meta.url), "utf8");
const repositoryUrl = "https://github.com/aenze/checkdrop";

describe("public landing page", () => {
  it("shows the Checkdrop brand and a protected application login without public signup claims", () => {
    expect(page).toContain("Checkdrop");
    expect(page).toContain("https://app.checkdrop.dev/integrations");
    expect(page).toContain("Log in");
    expect(page).toContain("support@checkdrop.dev");
    expect(page).toContain("RÚIAN");
    expect(page).toContain("ARES");
    expect(page).not.toContain("Zaregistrovat");
  });

  it("offers exactly two prices: paid deployment from CZK 9,900 and free open source", () => {
    expect(page).toContain("from CZK 9,900");
    expect(page).toContain("Free");
    expect(page).not.toContain("[CENA]");
    expect(czech).toContain("od 9 900 Kč");
    expect(czech).toContain("Zdarma");
  });

  it("links the English and Czech versions to each other", () => {
    expect(page).toContain('href="/cs/"');
    expect(czech).toContain('href="/"');
    expect(czech).toContain('name="robots" content="noindex, nofollow, noarchive"');
  });

  it("keeps the temporary public page out of search indexes", () => {
    expect(page).toContain('name="robots" content="noindex, nofollow, noarchive"');
  });

  it("keeps the GitHub repository URL in one constant per page", () => {
    for (const source of [page, czech, developers, vyvojari]) {
      expect(source.split(repositoryUrl)).toHaveLength(2);
      expect(source).toContain("href={GITHUB_URL}");
    }
  });

  it("explains self-hosting, licences and data attribution on both developer pages", () => {
    for (const source of [developers, vyvojari]) {
      expect(source).toContain("${GITHUB_URL}/blob/main/INSTALL.md");
      expect(source).toContain("href={INSTALL_URL}");
      expect(source).toContain("AGPL-3.0");
      expect(source).toContain("MIT");
      expect(source).toContain("RÚIAN ©&nbsp;ČÚZK, CC&nbsp;BY&nbsp;4.0");
    }
    expect(developers).toContain('id="self-hosting"');
    expect(vyvojari).toContain('id="vlastni-server"');
    expect(page).toContain('href="/developers/#self-hosting"');
    expect(czech).toContain('href="/cs/vyvojari/#vlastni-server"');
  });
});
