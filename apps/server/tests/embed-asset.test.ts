import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { describeEmbedScript, minifyEmbedScript } from "../scripts/minify-embed.mjs";
import { createApp } from "../src/app.js";
import { embedAssetFrom, loadEmbedAsset } from "../src/embed-asset.js";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function distDirectory(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "checkdrop-embed-"));
  directories.push(directory);
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(directory, name), content);
  return pathToFileURL(`${directory}/`);
}

describe("hosted embed asset", () => {
  it("loads the minified build output when its manifest matches", async () => {
    const code = await minifyEmbedScript(CHECKDROP_EMBED_SCRIPT);
    const manifest = describeEmbedScript(code);
    const asset = loadEmbedAsset({
      distDir: distDirectory({
        "embed.min.js": code,
        "embed.min.json": JSON.stringify(manifest),
      }),
    });
    expect(asset.minified).toBe(true);
    expect(asset.body).toBe(code);
    expect(manifest.gzipBytes).toBeLessThan(describeEmbedScript(CHECKDROP_EMBED_SCRIPT).gzipBytes);
  });

  it("falls back to the readable script when the build output is missing or altered", async () => {
    expect(loadEmbedAsset({ distDir: distDirectory({}) })).toMatchObject({
      minified: false,
      body: CHECKDROP_EMBED_SCRIPT,
    });
    const altered = loadEmbedAsset({
      distDir: distDirectory({
        "embed.min.js": "void 0;",
        "embed.min.json": JSON.stringify({ sha256: "0".repeat(64) }),
      }),
    });
    expect(altered.minified).toBe(false);
  });

  it("serves a strong ETag, answers revalidation with 304 and keeps security headers", async () => {
    const asset = embedAssetFrom("console.log(1);", true);
    const app = createApp({ embedAsset: asset, pilotStore: null });
    const first = await app.request("/v1/embed.js");
    const etag = first.headers.get("ETag");
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("console.log(1);");
    expect(etag).toBe(`"${asset.sha256.slice(0, 32)}"`);
    expect(first.headers.get("Cache-Control")).toBe(
      "public, max-age=300, stale-while-revalidate=300, stale-if-error=86400",
    );
    expect(first.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(first.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const revalidated = await app.request("/v1/embed.js", {
      headers: { "If-None-Match": `W/"other", ${etag}` },
    });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
    expect(revalidated.headers.get("ETag")).toBe(etag);

    const stale = await app.request("/v1/embed.js", { headers: { "If-None-Match": '"other"' } });
    expect(stale.status).toBe(200);

    const changed = createApp({
      embedAsset: embedAssetFrom("console.log(2);", true),
      pilotStore: null,
    });
    expect((await changed.request("/v1/embed.js")).headers.get("ETag")).not.toBe(etag);
  });
});
