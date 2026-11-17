import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CHECKDROP_EMBED_SCRIPT } from "./embed-script.js";

export interface EmbedAsset {
  readonly body: string;
  /** Hex SHA-256 of body; the strong ETag is derived from it. */
  readonly sha256: string;
  readonly minified: boolean;
}

export function embedAssetFrom(body: string, minified: boolean): EmbedAsset {
  return { body, sha256: createHash("sha256").update(body).digest("hex"), minified };
}

/**
 * Loads the minified hosted script produced by the build next to the compiled server. A missing
 * or mismatching file falls back to the unminified script; it never stops the server from starting.
 */
export function loadEmbedAsset(options: { readonly distDir?: URL } = {}): EmbedAsset {
  const directory = options.distDir ?? new URL(".", import.meta.url);
  try {
    const body = readFileSync(new URL("embed.min.js", directory), "utf8");
    const manifest = JSON.parse(readFileSync(new URL("embed.min.json", directory), "utf8")) as {
      sha256?: unknown;
    };
    const asset = embedAssetFrom(body, true);
    if (manifest.sha256 === asset.sha256) return asset;
  } catch {
    // Development and tests run from source without a build; serve the readable script.
  }
  return embedAssetFrom(CHECKDROP_EMBED_SCRIPT, false);
}
