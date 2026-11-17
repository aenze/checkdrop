// Real-browser latency baseline for hosted checkout assistance (stage 1, plan A1).
//
// Starts the Checkdrop API in-process against a local PostgreSQL with a full RÚIAN snapshot,
// serves a synthetic checkout page over HTTPS/2 on *.checkdrop-bench.test, and replays the
// typing sequences from fixtures/assistance/typing-cases.json in Chromium with emulated network
// and CPU profiles. Nothing is sent to production. Customer-like values are synthetic.
//
// Usage:
//   CHECKDROP_DATABASE_URL=postgresql://checkdrop:checkdrop@127.0.0.1:5432/checkdrop \
//     pnpm benchmark:assistance-latency [--repetitions 5] [--cases email-,address-] \
//     [--profiles desktop,mobile] [--out path.json]
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createSecureServer } from "node:http2";
import { createRequire } from "node:module";
import { cpus, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { type BrowserContext, chromium, type Page } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index]?.replace(/^--/, "") ?? "", process.argv[index + 1] ?? "");
}
const repetitions = Number(args.get("repetitions") ?? 5);
const casePrefixes = (args.get("cases") ?? "").split(",").filter(Boolean);
const profileNames = (args.get("profiles") ?? "desktop,mobile").split(",");
// Optional visual check: saves a screenshot after the first repetition of every case.
const screenshotDir = args.get("screenshots") ? resolve(root, args.get("screenshots") ?? "") : null;
const outPath = resolve(root, args.get("out") ?? "benchmarks/results/assistance-latency.json");
const databaseUrl = process.env.CHECKDROP_DATABASE_URL;
if (!databaseUrl) throw new Error("Set CHECKDROP_DATABASE_URL to a local database with RÚIAN.");

const SHOP_PORT = 9443;
const API_PORT = 9444;
const SHOP_ORIGIN = `https://shop.checkdrop-bench.test:${SHOP_PORT}`;
const API_ORIGIN = `https://api.checkdrop-bench.test:${API_PORT}`;

// Emulated profiles. Latency is added by Chromium per request (request sent -> headers received).
const PROFILES = {
  desktop: {
    viewport: { width: 1470, height: 900 },
    isMobile: false,
    network: { latency: 50, downloadThroughput: 1_250_000, uploadThroughput: 625_000 },
    cpuRate: 1,
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    network: { latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 },
    cpuRate: 4,
  },
} as const;
type ProfileName = keyof typeof PROFILES;

type Step =
  | { type: string; text: string; append?: boolean }
  | { fill: string; text: string }
  | { blur: string }
  | { focus: string }
  | { clear: string }
  | { press: string; key: string }
  | { select: string; value: string }
  | { check: string }
  | { uncheck: string }
  | { pause: number };
type TypingCase = {
  id: string;
  category: string;
  steps: Step[];
  expect: { none: true } | { field: string; outcome: string; context?: string };
  offline?: boolean;
};
type Timing = {
  field: string;
  context: string;
  source: string;
  outcome: string;
  inputToRenderMs: number | null;
  requestMs: number | null;
};

const fixture = JSON.parse(
  readFileSync(join(root, "fixtures/assistance/typing-cases.json"), "utf8"),
) as { typing: { charDelayMs: number }; ruianDataset: string; cases: TypingCase[] };
const cases = fixture.cases.filter(
  (item) => casePrefixes.length === 0 || casePrefixes.some((prefix) => item.id.startsWith(prefix)),
);
if (cases.length === 0) throw new Error("No typing cases selected.");

const TARGETS: Record<string, string> = {
  "billing.email": "#email",
  "billing.country": "#country",
  "billing.street": "#street",
  "billing.city": "#city",
  "billing.zip": "#zip",
  "shipping.toggle": "#ship-different",
  "shipping.street": "#ship-street",
  "newsletter.email": "#newsletter-email",
};

// Server configuration is set before the app modules read it.
Object.assign(process.env, {
  CHECKDROP_DATABASE_URL: databaseUrl,
  CHECKDROP_EMBED_SIGNING_SECRET: randomBytes(32).toString("hex"),
  CHECKDROP_OPERATOR_TOKEN: randomBytes(24).toString("hex"),
  CHECKDROP_OPERATOR_PROJECT_REF: "local-benchmark",
  CHECKDROP_OBSERVATION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
});
const serverRequire = createRequire(join(root, "apps/server/package.json"));
const pg = createRequire(join(root, "packages/db/package.json"))("pg") as typeof import("pg");
const { getRequestListener } = serverRequire(
  "@hono/node-server",
) as typeof import("@hono/node-server");
// The compiled server is used on purpose: the hosted script is built from Function.toString(),
// and a source transform (tsx/esbuild) would inject helpers that do not exist in the browser.
// Run `pnpm --filter @checkdrop/server... build` first.
const serverDist = join(root, "apps/server/dist");
const { createApp } = (await import(
  join(serverDist, "app.js")
)) as typeof import("../apps/server/src/app.ts");
const { createPilotRateLimiter } = (await import(
  join(serverDist, "rate-limit.js")
)) as typeof import("../apps/server/src/rate-limit.ts");
const { lookupEmailDns } = (await import(
  join(serverDist, "dns.js")
)) as typeof import("../apps/server/src/dns.ts");
const { CHECKDROP_EMBED_SCRIPT } = (await import(
  join(serverDist, "embed-script.js")
)) as typeof import("../apps/server/src/embed-script.ts");
// The asset the server actually serves; older builds without embed-asset serve the source string.
const servedEmbed = await import(join(serverDist, "embed-asset.js"))
  .then((module: typeof import("../apps/server/src/embed-asset.ts")) =>
    module.loadEmbedAsset({ distDir: pathToFileURL(`${serverDist}/`) }),
  )
  .catch(() => ({ body: CHECKDROP_EMBED_SCRIPT, minified: false }));

let dnsLookups = 0;
const serverTimings: { route: string; status: number; totalMs: number; phases: object }[] = [];
const app = createApp({
  rateLimiter: createPilotRateLimiter({ embedLimit: 1_000_000 }),
  lookupDns: (domain) => {
    dnsLookups += 1;
    return lookupEmailDns(domain);
  },
  onRequestTiming: (timing) => serverTimings.push(timing),
});

async function operator(method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Checkdrop-Operator-Key": process.env.CHECKDROP_OPERATOR_TOKEN ?? "",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text}`);
  const json = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  return json;
}

const field = (
  selector: string,
  canonical_field: string,
  context: string,
  validation_mode: "suggest" | "shadow",
  validation_trigger: "input" | "blur",
) => ({
  selector,
  label: canonical_field,
  canonical_field,
  context,
  condition_key: null,
  required: false,
  validation_mode,
  validation_trigger,
  detected: false,
});

async function provision() {
  const integration = await operator("POST", "/v1/operator/integrations", {
    name: "Benchmark nápovědy",
    client_name: `checkdrop-latency-bench-${Date.now()}`,
    environment: "test",
    form_url: `${SHOP_ORIGIN}/kosik`,
    form_name: "Objednávka",
  });
  const id = integration.id as string;
  const checkoutForm = (integration.forms as { id: string }[])[0];
  if (!checkoutForm) throw new Error("Integration has no initial form.");
  await operator("PUT", `/v1/operator/integrations/${id}/forms/${checkoutForm.id}/root`, {
    root_selector: "#checkout",
  });
  await operator("PUT", `/v1/operator/integrations/${id}/forms/${checkoutForm.id}/fields`, {
    fields: [
      field("#email", "email", "billing", "suggest", "blur"),
      field("#country", "country", "billing", "shadow", "blur"),
      field("#street", "street_line", "billing", "suggest", "input"),
      field("#city", "city", "billing", "shadow", "blur"),
      field("#zip", "postal_code", "billing", "shadow", "blur"),
      field("#ship-country", "country", "shipping", "shadow", "blur"),
      field("#ship-street", "street_line", "shipping", "suggest", "input"),
      field("#ship-city", "city", "shipping", "shadow", "blur"),
      field("#ship-zip", "postal_code", "shipping", "shadow", "blur"),
    ],
  });
  await operator("POST", `/v1/operator/integrations/${id}/forms/${checkoutForm.id}/state`, {
    state: "configured",
  });
  const withNewsletter = await operator("POST", `/v1/operator/integrations/${id}/forms`, {
    name: "Newsletter",
    form_url: `${SHOP_ORIGIN}/kosik`,
    root_selector: "#newsletter",
  });
  const newsletterForm = (withNewsletter.forms as { id: string; name: string }[]).find(
    (form) => form.name === "Newsletter",
  );
  if (!newsletterForm) throw new Error("Newsletter form was not created.");
  await operator("PUT", `/v1/operator/integrations/${id}/forms/${newsletterForm.id}/fields`, {
    fields: [field("#newsletter-email", "email", "shared", "suggest", "blur")],
  });
  await operator("POST", `/v1/operator/integrations/${id}/forms/${newsletterForm.id}/state`, {
    state: "configured",
  });
  await operator("POST", `/v1/operator/integrations/${id}/keys`, { name: "benchmark" });
  const shadow = await operator("POST", `/v1/operator/integrations/${id}/state`, {
    state: "shadow",
  });
  return { id, siteKey: `cdp_site_${id}`, configVersion: shadow.config_version ?? null };
}

function checkoutPage(siteKey: string) {
  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Syntetický košík</title>
<style>body{font:16px system-ui;margin:0 auto;max-width:640px;padding:16px}label{display:block;margin:10px 0 4px}input,select{width:100%;box-sizing:border-box;padding:8px;font:inherit}fieldset{border:1px solid #ccc;margin:16px 0}</style>
<script async src="${API_ORIGIN}/v1/embed.js" data-checkdrop-site="${siteKey}"></script>
</head><body>
<form id="checkout" onsubmit="return false">
<fieldset><legend>Fakturační údaje</legend>
<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="off">
<label for="country">Země</label><select id="country" name="country"><option value="CZ">Česko</option><option value="SK">Slovensko</option></select>
<label for="street">Ulice a číslo</label><input id="street" name="street" autocomplete="off">
<label for="city">Obec</label><input id="city" name="city" autocomplete="off">
<label for="zip">PSČ</label><input id="zip" name="zip" autocomplete="off">
</fieldset>
<label><input id="ship-different" type="checkbox" style="width:auto"> Doručit jinam</label>
<fieldset id="shipping" hidden><legend>Doručovací adresa</legend>
<label for="ship-country">Země</label><select id="ship-country"><option value="CZ">Česko</option><option value="SK">Slovensko</option></select>
<label for="ship-street">Ulice a číslo</label><input id="ship-street" autocomplete="off">
<label for="ship-city">Obec</label><input id="ship-city" autocomplete="off">
<label for="ship-zip">PSČ</label><input id="ship-zip" autocomplete="off">
</fieldset>
<button type="submit">Objednat</button>
</form>
<form id="newsletter" onsubmit="return false"><label for="newsletter-email">Newsletter</label><input id="newsletter-email" type="email" autocomplete="off"><button type="submit">Odebírat</button></form>
<script>document.getElementById("ship-different").addEventListener("change",function(e){document.getElementById("shipping").hidden=!e.target.checked;});</script>
</body></html>`;
}

function certificate() {
  const directory = mkdtempSync(join(tmpdir(), "checkdrop-bench-"));
  const key = join(directory, "key.pem");
  const cert = join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=checkdrop-bench.test",
      "-addext",
      "subjectAltName=DNS:shop.checkdrop-bench.test,DNS:api.checkdrop-bench.test",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  const pair = { key: readFileSync(key), cert: readFileSync(cert) };
  rmSync(directory, { recursive: true, force: true });
  return pair;
}

const tls = certificate();
const provisioned = await provision();
const html = checkoutPage(provisioned.siteKey);
// Production compresses API responses at Caddy and Cloudflare; mirror that with gzip here.
async function compressedFetch(request: Request) {
  const response = await app.fetch(request);
  const accepts = request.headers.get("accept-encoding") ?? "";
  if (!response.body || !/\bgzip\b/.test(accepts) || response.headers.has("content-encoding"))
    return response;
  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  headers.append("vary", "Accept-Encoding");
  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status,
    headers,
  });
}
const apiServer = createSecureServer(
  { ...tls, allowHTTP1: true },
  getRequestListener(compressedFetch) as never,
);
const shopServer = createSecureServer({ ...tls, allowHTTP1: true }, (request, response) => {
  if (request.url?.startsWith("/kosik")) {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(html);
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise<void>((done) => apiServer.listen(API_PORT, "127.0.0.1", done));
await new Promise<void>((done) => shopServer.listen(SHOP_PORT, "127.0.0.1", done));

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
async function databaseCounters() {
  const result = await pool.query<{ transactions: string; returned: string }>(
    `SELECT (xact_commit + xact_rollback)::text AS transactions, tup_returned::text AS returned
       FROM pg_stat_database WHERE datname = current_database()`,
  );
  return {
    transactions: Number(result.rows[0]?.transactions),
    rowsReturned: Number(result.rows[0]?.returned),
  };
}

const browser = await chromium.launch({
  headless: true,
  args: ["--host-resolver-rules=MAP *.checkdrop-bench.test 127.0.0.1"],
});

async function newContext(profile: ProfileName) {
  const settings = PROFILES[profile];
  return browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: settings.viewport,
    isMobile: settings.isMobile,
    hasTouch: settings.isMobile,
    locale: "cs-CZ",
    reducedMotion: "reduce",
  });
}

const cdpSessions = new WeakMap<Page, import("playwright").CDPSession>();

async function preparePage(context: BrowserContext, profile: ProfileName) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    ...PROFILES[profile].network,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILES[profile].cpuRate });
  cdpSessions.set(page, cdp);
  await page.addInitScript(() => {
    const bench = {
      events: [] as unknown[],
      domContentLoadedAt: null as number | null,
      readyAt: null as number | null,
    };
    Object.assign(window, { __bench: bench });
    document.addEventListener("DOMContentLoaded", () => {
      bench.domContentLoadedAt = performance.now();
    });
    document.addEventListener("checkdrop:ready", () => {
      bench.readyAt ??= performance.now();
    });
    document.addEventListener("checkdrop:assist-timing", (event) => {
      bench.events.push((event as CustomEvent).detail);
    });
  });
  return page;
}

async function runStep(page: Page, step: Step) {
  const locator = (target: string) => {
    const selector = TARGETS[target];
    if (!selector) throw new Error(`Unknown target ${target}`);
    return page.locator(selector);
  };
  if ("pause" in step) return page.waitForTimeout(step.pause);
  if ("type" in step) {
    const element = locator(step.type);
    await element.focus();
    if (step.append) await element.press("End");
    // pressSequentially types characters outside the US layout (č, í, ž) with a double delay,
    // which a Czech keyboard does not. Keep one interval per character instead.
    for (const character of step.text) {
      const started = Date.now();
      if (/^[\x20-\x7e]$/.test(character))
        await page.keyboard.press(character === " " ? "Space" : character);
      else await page.keyboard.insertText(character);
      const rest = fixture.typing.charDelayMs - (Date.now() - started);
      if (rest > 0) await page.waitForTimeout(rest);
    }
    return;
  }
  if ("fill" in step) return locator(step.fill).fill(step.text);
  if ("blur" in step) return locator(step.blur).blur();
  if ("focus" in step) return locator(step.focus).focus();
  if ("clear" in step) return locator(step.clear).clear();
  if ("press" in step) return locator(step.press).press(step.key);
  if ("select" in step) return locator(step.select).selectOption(step.value);
  if ("check" in step) return locator(step.check).check();
  if ("uncheck" in step) return locator(step.uncheck).uncheck();
}

function matchesExpectation(item: TypingCase, events: Timing[]) {
  // A cancelled request shows nothing, so it does not break an expectation of no hint.
  if ("none" in item.expect) return events.every((event) => event.outcome === "aborted");
  const expected = item.expect;
  const last = [...events].reverse().find(
    (event) =>
      event.field === expected.field &&
      (!expected.context || event.context === expected.context) &&
      // A superseded request can finish after the final hint; it does not describe the screen.
      (event.outcome !== "aborted" || expected.outcome === "aborted"),
  );
  return last?.outcome === expected.outcome;
}

async function settle(page: Page, item: TypingCase) {
  const started = Date.now();
  // The runtime aborts a request after 2.5 s; 4 s after the last step every request has settled.
  while (Date.now() - started < 4_000) {
    const events = (await page.evaluate(
      () => (window as never as { __bench: { events: Timing[] } }).__bench.events,
    )) as Timing[];
    if (!("none" in item.expect) && matchesExpectation(item, events)) {
      await page.waitForTimeout(250);
      return;
    }
    await page.waitForTimeout(100);
  }
}

type Run = {
  profile: ProfileName;
  cache: "cold" | "warm";
  repetition: number;
  caseId: string;
  category: string;
  expected: TypingCase["expect"];
  matchedExpectation: boolean;
  events: Timing[];
  apiRequests: Record<string, number>;
  page: {
    readyAfterDomContentLoadedMs: number | null;
    embed: {
      encodedBytes: number;
      protocol: string;
      fromCache: boolean;
      contentEncoding: string | null;
    } | null;
  };
  error?: string;
};

async function runCase(
  page: Page,
  profile: ProfileName,
  cache: Run["cache"],
  repetition: number,
  item: TypingCase,
): Promise<Run> {
  const apiRequests: Record<string, number> = {};
  const cdp = cdpSessions.get(page);
  const embed = {
    requestId: null as string | null,
    protocol: "",
    fromCache: true,
    contentEncoding: null as string | null,
    encodedBytes: 0,
  };
  const onEmbedResponse = (event: {
    requestId: string;
    response: {
      url: string;
      protocol?: string;
      fromDiskCache?: boolean;
      headers: Record<string, string>;
    };
  }) => {
    if (!event.response.url.startsWith(`${API_ORIGIN}/v1/embed.js`)) return;
    embed.requestId = event.requestId;
    embed.protocol = event.response.protocol ?? "";
    embed.fromCache = event.response.fromDiskCache === true;
    embed.contentEncoding =
      Object.entries(event.response.headers).find(
        ([name]) => name.toLowerCase() === "content-encoding",
      )?.[1] ?? null;
  };
  const onLoadingFinished = (event: { requestId: string; encodedDataLength: number }) => {
    if (event.requestId === embed.requestId) embed.encodedBytes = event.encodedDataLength;
  };
  cdp?.on("Network.responseReceived", onEmbedResponse);
  cdp?.on("Network.loadingFinished", onLoadingFinished);
  const onRequest = (request: { url(): string }) => {
    const url = new URL(request.url());
    if (url.origin === API_ORIGIN) apiRequests[url.pathname] = (apiRequests[url.pathname] ?? 0) + 1;
  };
  page.on("request", onRequest);
  if (process.env.BENCH_DEBUG) {
    page.on("console", (message) => console.log("console:", message.type(), message.text()));
    page.on("request", (request) => {
      if (request.url().includes("/addresses/"))
        console.log("address request:", Math.round(performance.now()), request.postData());
    });
    page.on("response", async (response) => {
      if (response.url().includes("/addresses/"))
        console.log(
          "address response:",
          response.status(),
          (await response.text().catch(() => "")).slice(0, 400),
        );
    });
    page.on("response", async (response) => {
      if (response.url().includes("/config"))
        console.log("config:", response.status(), JSON.stringify(await response.allHeaders()));
    });
  }
  if (item.offline) {
    await page.route(/\/v1\/(emails|addresses)\//, (route) => route.abort("connectionrefused"));
  }
  const run: Run = {
    profile,
    cache,
    repetition,
    caseId: item.id,
    category: item.category,
    expected: item.expect,
    matchedExpectation: false,
    events: [],
    apiRequests,
    page: { readyAfterDomContentLoadedMs: null, embed: null },
  };
  try {
    await page.goto(`${SHOP_ORIGIN}/kosik`, { waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(
        () => (window as never as { __bench: { readyAt: number | null } }).__bench.readyAt !== null,
        undefined,
        { timeout: 15_000 },
      )
      .catch(async (error) => {
        if (process.env.BENCH_DEBUG)
          console.log(
            "debug:",
            await page.evaluate(() =>
              JSON.stringify({
                bench: (window as never as { __bench: unknown }).__bench,
                scripts: [...document.scripts].map((s) => s.src),
              }),
            ),
          );
        throw error;
      });
    for (const step of item.steps) await runStep(page, step);
    await settle(page, item);
    if (screenshotDir && repetition === 1) {
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        path: join(screenshotDir, `${profile}-${cache}-${item.id}.png`),
        fullPage: false,
      });
    }
    const snapshot = await page.evaluate(() => {
      const bench = (
        window as never as {
          __bench: { events: unknown[]; domContentLoadedAt: number; readyAt: number };
        }
      ).__bench;
      return { events: bench.events, ready: bench.readyAt - bench.domContentLoadedAt };
    });
    run.events = snapshot.events as Timing[];
    run.page.readyAfterDomContentLoadedMs = Math.round(snapshot.ready * 10) / 10;
    // No CDP response at all means Chromium served the script from its memory cache.
    run.page.embed = {
      encodedBytes: embed.requestId && !embed.fromCache ? embed.encodedBytes : 0,
      protocol: embed.protocol,
      fromCache: embed.requestId === null || embed.fromCache || embed.encodedBytes === 0,
      contentEncoding: embed.contentEncoding,
    };
    run.matchedExpectation = matchesExpectation(item, run.events);
  } catch (error) {
    run.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
  } finally {
    page.off("request", onRequest);
    cdp?.off("Network.responseReceived", onEmbedResponse);
    cdp?.off("Network.loadingFinished", onLoadingFinished);
    if (item.offline) await page.unroute(/\/v1\/(emails|addresses)\//);
  }
  return run;
}

const runs: Run[] = [];
const databaseBefore = await databaseCounters();
const startedAt = new Date();
const total = profileNames.length * 2 * repetitions * cases.length;
for (const profile of profileNames as ProfileName[]) {
  if (!PROFILES[profile]) throw new Error(`Unknown profile ${profile}`);
  for (const cache of ["cold", "warm"] as const) {
    let warmContext: BrowserContext | null = null;
    let warmPage: Page | null = null;
    if (cache === "warm") {
      warmContext = await newContext(profile);
      warmPage = await preparePage(warmContext, profile);
      await warmPage.goto(`${SHOP_ORIGIN}/kosik`, { waitUntil: "load" });
    }
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (const item of cases) {
        let context = warmContext;
        let page = warmPage;
        if (cache === "cold") {
          context = await newContext(profile);
          page = await preparePage(context, profile);
        }
        if (!page || !context) throw new Error("Browser page is not ready.");
        const run = await runCase(page, profile, cache, repetition, item);
        runs.push(run);
        if (cache === "cold") await context.close();
        process.stdout.write(
          `\r${runs.length}/${total} ${profile} ${cache} r${repetition} ${item.id.padEnd(40)} ${run.error ? "ERROR" : run.matchedExpectation ? "ok" : "differs"}   `,
        );
      }
    }
    await warmContext?.close();
  }
}
process.stdout.write("\n");
const databaseAfter = await databaseCounters();

function summarizeServerTimings() {
  const byRoute = new Map<string, number[]>();
  for (const timing of serverTimings) {
    if (timing.route.startsWith("/v1/operator/")) continue;
    const key = `${timing.route} ${timing.status}`;
    byRoute.set(key, [...(byRoute.get(key) ?? []), timing.totalMs]);
  }
  const percentile = (values: number[], p: number) =>
    values[Math.ceil(p * values.length) - 1] ?? null;
  return [...byRoute.entries()].map(([key, values]) => {
    const sorted = values.sort((a, b) => a - b);
    const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
    return {
      route: key,
      count: sorted.length,
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      p99: round(percentile(sorted, 0.99)),
      max: round(sorted.at(-1) ?? null),
    };
  });
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root })
  .toString()
  .trim();
const dirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root }).toString().trim() !== "";
const apiRequestCount = runs.reduce(
  (sum, run) => sum + Object.values(run.apiRequests).reduce((a, b) => a + b, 0),
  0,
);
const output = {
  meta: {
    kind: "assistance-latency",
    label: args.get("label") ?? "baseline",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    commit,
    workingTreeDirty: dirty,
    node: process.version,
    machine: `${cpus()[0]?.model ?? "unknown"}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GiB`,
    chromium: browser.version(),
    ruianDataset: fixture.ruianDataset,
    integrationConfigVersion: provisioned.configVersion,
    typing: `${fixture.typing.charDelayMs} ms per character; non-ASCII characters via insertText`,
    transport: "local HTTPS/2 over loopback with Chromium network emulation; not production",
    profiles: Object.fromEntries(profileNames.map((name) => [name, PROFILES[name as ProfileName]])),
    cacheModes: {
      cold: "new browser context per run: empty HTTP cache, new TLS connection",
      warm: "one browser context per profile: embed.js cached by max-age=300, connections reused",
    },
    repetitions,
    caseCount: cases.length,
    embedScript: {
      minified: servedEmbed.minified,
      bytes: Buffer.byteLength(servedEmbed.body),
      gzipBytes: gzipSync(servedEmbed.body, { level: 9 }).length,
    },
    server: {
      dnsLookups,
      requests: serverTimings.length,
      browserApiRequests: apiRequestCount,
      database: {
        transactions: databaseAfter.transactions - databaseBefore.transactions,
        rowsReturned: databaseAfter.rowsReturned - databaseBefore.rowsReturned,
        note: "pg_stat_database deltas for the whole run, includes benchmark bookkeeping",
      },
    },
  },
  serverTimings: summarizeServerTimings(),
  runs,
};
writeFileSync(outPath, `${JSON.stringify(output)}\n`);
const errors = runs.filter((run) => run.error).length;
const differing = runs.filter((run) => !run.error && !run.matchedExpectation);
console.log(
  `Saved ${runs.length} runs to ${outPath}; errors ${errors}; differing ${differing.length}.`,
);
await browser.close();
await pool.end();
apiServer.close();
shopServer.close();
process.exit(0);
