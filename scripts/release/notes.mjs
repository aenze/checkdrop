// Prints the CHANGELOG section of one version, used as the GitHub release notes.
//   node scripts/release/notes.mjs <version>
import { readFileSync } from "node:fs";

const version = process.argv[2];
const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
const start = changelog.search(new RegExp(`^## ${version.replaceAll(".", "\\.")}\\b`, "m"));
if (start < 0) {
  console.error(`CHANGELOG.md has no section "## ${version}".`);
  process.exit(1);
}
const rest = changelog.slice(start);
const end = rest.slice(3).search(/^## /m);
process.stdout.write(`${(end < 0 ? rest : rest.slice(0, end + 3)).trim()}\n`);
