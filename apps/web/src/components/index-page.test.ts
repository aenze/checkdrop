import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../pages/index.astro", import.meta.url), "utf8");
const czech = readFileSync(new URL("../pages/cs/index.astro", import.meta.url), "utf8");
const developers = readFileSync(new URL("../pages/developers.astro", import.meta.url), "utf8");
const vyvojari = readFileSync(new URL("../pages/cs/vyvojari.astro", import.meta.url), "utf8");
const repositoryUrl = "https://github.com/aenze/checkdrop";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const contact = read("../pages/kontakt.astro");
const terms = read("../pages/podminky.astro");
const privacy = read("../pages/soukromi.astro");
const processing = read("../pages/zpracovani.astro");
const analytics = read("./SiteAnalytics.astro");
const robots = read("../../public/robots.txt");
const sitemap = read("../../public/sitemap.xml");

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
  });

  it("lets search engines index the public pages and measures them with Umami", () => {
    for (const source of [page, czech, developers, vyvojari, contact]) {
      expect(source).not.toContain('name="robots"');
      expect(source).toContain("<SiteAnalytics />");
    }
    // Drafts of the legal texts stay out of search results until they are final.
    for (const source of [terms, privacy, processing]) {
      expect(source).toContain('name="robots" content="noindex, nofollow, noarchive"');
      expect(source).toContain("<SiteAnalytics />");
    }
    expect(analytics).toContain('data-domains="checkdrop.dev,www.checkdrop.dev"');
    expect(privacy).toContain("Umami");
    expect(privacy).not.toContain("neobsahuje analytické");
    expect(robots).toContain("Sitemap: https://checkdrop.dev/sitemap.xml");
    expect(sitemap).toContain("<loc>https://checkdrop.dev/cs/vyvojari/</loc>");
    expect(sitemap).not.toContain("soukromi");
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
