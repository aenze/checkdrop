// Writes release.json for a release: version, image names and SHA-256 of the files the updater
// downloads. One line, so install.sh can read it without jq or Node.
//   node scripts/release/manifest.mjs <version> <image-prefix> <dir-with-files>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [version, prefix, dir] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !prefix || !dir) {
  console.error("Usage: manifest.mjs <x.y.z> <image-prefix> <dir>");
  process.exit(2);
}
const sha = (file) =>
  createHash("sha256")
    .update(readFileSync(join(dir, file)))
    .digest("hex");
const manifest = {
  version,
  images: { server: `${prefix}-server:${version}`, web: `${prefix}-web:${version}` },
  files: { checkdrop: sha("checkdrop"), "compose.yaml": sha("compose.yaml") },
};
writeFileSync(join(dir, "release.json"), `${JSON.stringify(manifest)}\n`);
console.log(JSON.stringify(manifest));
