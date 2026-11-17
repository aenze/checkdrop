// Shared by the build and by tests, so the tested minified script is produced the same way.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { transform } from "esbuild";

// The checkout script runs inside shops' pages and is MIT licensed; the banner keeps that visible.
export const EMBED_LICENSE_BANNER =
  "/*! Checkdrop checkout script | MIT License | https://github.com/aenze/checkdrop */";

/**
 * Minifies the composed hosted script. The script is built from Function.toString(), so only the
 * final string is transformed; property names stay intact because esbuild never mangles them.
 */
export async function minifyEmbedScript(source) {
  const result = await transform(source, {
    minify: true,
    target: "es2023",
    legalComments: "none",
    charset: "utf8",
  });
  // Parse check: a broken script must fail the build, never reach a checkout.
  new Function(result.code);
  return `${EMBED_LICENSE_BANNER}\n${result.code}`;
}

export function describeEmbedScript(code) {
  return {
    sha256: createHash("sha256").update(code).digest("hex"),
    bytes: Buffer.byteLength(code),
    gzipBytes: gzipSync(code, { level: 9 }).length,
  };
}
