import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getActiveRuianDataset,
  importRuianAddresses,
  pruneArchivedRuianDatasets,
} from "./ruian.js";

const DEFAULT_BASE_URL = "https://vdp.cuzk.gov.cz/vymenny_format/specialni";
const MAX_COMPRESSED_BYTES = 160 * 1_024 * 1_024;
const MAX_XML_BYTES = 4 * 1_024 * 1_024 * 1_024;
const ARCHIVE_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1_000;

export interface RuianSnapshotCandidate {
  dateKey: string;
  url: string;
  xmlEntry: string;
}

export function resolveRuianSnapshotCandidates(
  now: Date,
  baseUrl = DEFAULT_BASE_URL,
): RuianSnapshotCandidate[] {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (now.getUTCDate() < 4) current.setUTCMonth(current.getUTCMonth() - 1);
  return [0, 1, 2].map((monthsBack) => {
    const date = new Date(current);
    date.setUTCMonth(date.getUTCMonth() - monthsBack);
    const dateKey = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}03`;
    const xmlEntry = `${dateKey}_ST_UADS.xml`;
    return {
      dateKey,
      xmlEntry,
      url: `${baseUrl.replace(/\/$/, "")}/${xmlEntry}.zip`,
    };
  });
}

export function pragueDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(value)
    .filter((part) => part.type !== "literal")
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year ?? ""}${parts.month ?? ""}${parts.day ?? ""}`;
}

const connectionString = process.env.CHECKDROP_DATABASE_URL;
if (!connectionString) throw new Error("CHECKDROP_DATABASE_URL is required for RÚIAN update.");

await access("/usr/bin/unzip", constants.X_OK).catch(() =>
  access("/bin/unzip", constants.X_OK).catch(() => {
    throw new Error("The unzip executable is required for RÚIAN update.");
  }),
);

const now = new Date();
const dryRun = process.argv.includes("--dry-run");
const customBaseUrl = process.env.CHECKDROP_RUIAN_BASE_URL;
if (customBaseUrl) validateBaseUrl(customBaseUrl);
const candidates = resolveRuianSnapshotCandidates(now, customBaseUrl ?? DEFAULT_BASE_URL);
const candidate = await findAvailableSnapshot(candidates);
if (!candidate) throw new Error("No recent RÚIAN ST_UADS snapshot is available.");

const active = await getActiveRuianDataset(connectionString);
const activeDateKey = active ? pragueDateKey(new Date(active.effectiveAt)) : null;
const pruneBefore = new Date(now.getTime() - ARCHIVE_RETENTION_MS);

if (dryRun) {
  process.stdout.write(
    `${JSON.stringify({
      event: "ruian.update.plan",
      candidate,
      active,
      action: activeDateKey === candidate.dateKey ? "unchanged" : "import",
      pruneBefore: pruneBefore.toISOString(),
    })}\n`,
  );
  process.exit(0);
}

if (activeDateKey === candidate.dateKey) {
  const pruned = await pruneArchivedRuianDatasets(connectionString, pruneBefore);
  process.stdout.write(
    `${JSON.stringify({ event: "ruian.update.unchanged", active, pruned }, null, 2)}\n`,
  );
  process.exit(0);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "checkdrop-ruian-"));
const zipPath = join(temporaryDirectory, `${candidate.dateKey}_ST_UADS.xml.zip`);
try {
  const compressedBytes = await downloadSnapshot(candidate.url, zipPath);
  const unzip = spawn("unzip", ["-p", zipPath, candidate.xmlEntry], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let unzipError = "";
  unzip.stderr.setEncoding("utf8");
  unzip.stderr.on("data", (chunk: string) => {
    if (unzipError.length < 8_192) unzipError += chunk;
  });
  const unzipCompletion = new Promise<void>((resolve, reject) => {
    unzip.once("error", reject);
    unzip.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`RÚIAN archive extraction failed (${code}): ${unzipError.trim()}`));
    });
  });

  try {
    const result = await importRuianAddresses({
      connectionString,
      input: boundedInput(unzip.stdout, MAX_XML_BYTES),
      onProgress(progress) {
        process.stderr.write(
          `${JSON.stringify({ event: "ruian.update.progress", ...progress })}\n`,
        );
      },
    });
    await unzipCompletion;
    const pruned = await pruneArchivedRuianDatasets(connectionString, pruneBefore);
    process.stdout.write(
      `${JSON.stringify(
        {
          event: "ruian.update.complete",
          compressedBytes,
          sourceUrl: candidate.url,
          result,
          pruned,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    unzip.kill("SIGTERM");
    await unzipCompletion.catch(() => undefined);
    throw error;
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function validateBaseUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("CHECKDROP_RUIAN_BASE_URL must use HTTPS.");
}

async function findAvailableSnapshot(
  candidatesToCheck: readonly RuianSnapshotCandidate[],
): Promise<RuianSnapshotCandidate | null> {
  for (const item of candidatesToCheck) {
    const response = await fetch(item.url, {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`RÚIAN snapshot check failed with HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
      throw new Error("RÚIAN snapshot does not declare a valid Content-Length.");
    }
    if (contentLength > MAX_COMPRESSED_BYTES) {
      throw new Error(`RÚIAN snapshot exceeds ${MAX_COMPRESSED_BYTES} compressed bytes.`);
    }
    return item;
  }
  return null;
}

async function downloadSnapshot(url: string, path: string): Promise<number> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`RÚIAN snapshot download failed with HTTP ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new Error("RÚIAN snapshot does not declare a valid Content-Length.");
  }
  if (declaredLength > MAX_COMPRESSED_BYTES) {
    throw new Error(`RÚIAN snapshot exceeds ${MAX_COMPRESSED_BYTES} compressed bytes.`);
  }

  const file = await open(path, "wx", 0o600);
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > MAX_COMPRESSED_BYTES) {
        throw new Error(`RÚIAN snapshot exceeds ${MAX_COMPRESSED_BYTES} compressed bytes.`);
      }
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  if (received !== declaredLength) {
    throw new Error(
      `RÚIAN snapshot length mismatch: expected ${declaredLength}, received ${received}.`,
    );
  }
  return received;
}

async function* boundedInput(
  input: AsyncIterable<Buffer | string>,
  maximumBytes: number,
): AsyncGenerator<Buffer | string> {
  let received = 0;
  for await (const chunk of input) {
    received += Buffer.byteLength(chunk);
    if (received > maximumBytes) {
      throw new Error(`RÚIAN XML exceeds ${maximumBytes} decompressed bytes.`);
    }
    yield chunk;
  }
}
