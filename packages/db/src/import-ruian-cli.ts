import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { importRuianAddresses } from "./ruian.js";

const connectionString = process.env.CHECKDROP_DATABASE_URL;
const inputPath = process.argv.slice(2).find((value) => value !== "--");

if (!connectionString) {
  throw new Error("CHECKDROP_DATABASE_URL is required for RÚIAN import.");
}
if (!inputPath) {
  throw new Error("Usage: pnpm ruian:import <path-to-ST_UADS.xml|->");
}

const resolvedInputPath =
  inputPath === "-" ? null : resolve(process.env.INIT_CWD ?? process.cwd(), inputPath);
if (resolvedInputPath) {
  await access(resolvedInputPath);
}

const input = resolvedInputPath ? createReadStream(resolvedInputPath) : process.stdin;
const result = await importRuianAddresses({
  connectionString,
  input,
  onProgress(progress) {
    process.stderr.write(`${JSON.stringify({ event: "ruian.import.progress", ...progress })}\n`);
  },
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
