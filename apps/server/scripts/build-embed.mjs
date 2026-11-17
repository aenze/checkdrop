// Writes dist/embed.min.js and its manifest after `tsc`. Fails the build on any error.
import { writeFileSync } from "node:fs";
import { CHECKDROP_EMBED_SCRIPT } from "../dist/embed-script.js";
import { describeEmbedScript, minifyEmbedScript } from "./minify-embed.mjs";

const code = await minifyEmbedScript(CHECKDROP_EMBED_SCRIPT);
const manifest = describeEmbedScript(code);
writeFileSync(new URL("../dist/embed.min.js", import.meta.url), code);
writeFileSync(new URL("../dist/embed.min.json", import.meta.url), `${JSON.stringify(manifest)}\n`);
const source = describeEmbedScript(CHECKDROP_EMBED_SCRIPT);
process.stdout.write(
  `embed.min.js ${manifest.bytes} B, gzip ${manifest.gzipBytes} B (source ${source.bytes} B, gzip ${source.gzipBytes} B)\n`,
);
