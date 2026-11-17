import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

/**
 * "app": the administration every installation runs, identical for everyone.
 * "site": the checkdrop.dev marketing website.
 * "all": both, for local development and the hosted service before it runs them separately.
 */
const target = process.env.CHECKDROP_WEB_TARGET ?? "all";
const outputs = {
  app: new Set(["_astro", "dashboard", "integrations", "monitor", "playground", "sign-in"]),
  site: new Set([
    "_astro",
    "index.html",
    "cs",
    "developers",
    "kontakt",
    "podminky",
    "soukromi",
    "zpracovani",
    "login",
    "frontpage",
    "robots.txt",
    "sitemap.xml",
  ]),
};
if (!["app", "site", "all"].includes(target)) {
  throw new Error("CHECKDROP_WEB_TARGET must be app, site or all.");
}

/** Keeps only the allow-listed output, so a new page never ships to the wrong place by default. */
function buildTarget() {
  return {
    name: "checkdrop-build-target",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        if (target === "all") return;
        const root = fileURLToPath(dir);
        for (const entry of await readdir(root)) {
          if (!outputs[target].has(entry))
            await rm(join(root, entry), { recursive: true, force: true });
        }
      },
    },
  };
}

const pilotApiKey = process.env.CHECKDROP_PILOT_API_KEY;
const operatorToken = process.env.CHECKDROP_OPERATOR_TOKEN;
const proxyTarget = process.env.CHECKDROP_PROXY_UPSTREAM_URL ?? "http://127.0.0.1:8080";

const proxy = {
  ...(operatorToken
    ? {
        "/checkdrop/v1/operator": {
          target: proxyTarget,
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/checkdrop/, ""),
          headers: {
            "X-Checkdrop-Operator-Key": operatorToken,
          },
        },
      }
    : {}),
  ...(pilotApiKey
    ? {
        "/checkdrop": {
          target: proxyTarget,
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/checkdrop/, ""),
          headers: {
            "X-Checkdrop-Key": pilotApiKey,
            "X-Checkdrop-Client": "checkdrop-review-local/0.1.0",
            "X-Checkdrop-Mode": "shadow",
            "X-Checkdrop-Observe": "preview",
          },
        },
      }
    : {}),
};

export default defineConfig({
  integrations: [react(), buildTarget()],
  output: "static",
  server: {
    host: "0.0.0.0",
    port: 4321,
  },
  vite: {
    server: {
      allowedHosts: ["localhost", "127.0.0.1", "terminal.local"],
      proxy: Object.keys(proxy).length > 0 ? proxy : undefined,
    },
  },
});
