// Local synthetic QA only. Run with playwright available on NODE_PATH.
const { chromium } = require("playwright");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    // Keep this test from loading the real Checkdrop service or any other external host.
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
    );
    await page.goto("http://127.0.0.1:4488/wp-login.php");
    await page.locator("#user_login").fill("checkdrop-qa");
    await page.locator("#user_pass").fill("Local-QA-only-2026!");
    await page.locator("#wp-submit").click();
    await page.waitForURL("**/wp-admin/**");
    await page.goto("http://127.0.0.1:4488/wp-admin/options-general.php?page=checkdrop");
    await page.locator("#checkdrop-key").waitFor();
    if (await page.locator("input[type=checkbox]").isChecked())
      throw new Error("Fresh install must be disabled");
    await page.locator("#checkdrop-key").fill("cdp_site_synthetic-qa");
    await page.locator("input[type=checkbox]").check();
    await page.locator("#submit").click();
    await page.waitForURL("**/*settings-updated=true*");
    if ((await page.locator("#checkdrop-key").inputValue()) !== "cdp_site_synthetic-qa")
      throw new Error("Key not saved");
    if (!(await page.locator("input[type=checkbox]").isChecked()))
      throw new Error("Enable flag not saved");
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(__dirname, "desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, "mobile.png"), fullPage: true });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Horizontal overflow");
    await page.goto("http://127.0.0.1:4488/");
    await page.locator("script[data-checkdrop-site]").waitFor({ state: "attached" });
    if ((await page.locator("script[data-checkdrop-site]").count()) !== 1)
      throw new Error("Duplicate embed");
    await page.goto("http://127.0.0.1:4488/wp-admin/options-general.php?page=checkdrop");
    await page.locator("input[type=checkbox]").uncheck();
    await page.locator("#submit").click();
    await page.waitForURL("**/*settings-updated=true*");
    await page.goto("http://127.0.0.1:4488/");
    if (await page.locator("script[data-checkdrop-site]").count())
      throw new Error("Disabled embed still present");
    console.log("Real WordPress: save, enable, single embed, disable, desktop/mobile widths PASS");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
