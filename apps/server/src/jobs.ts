import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createAdminAccountStore,
  createInstanceStatusStore,
  type InstanceStatusStore,
} from "@checkdrop/db";

/**
 * Scheduled work of one installation, run inside the installation instead of on the host:
 * the first address import right after installation, then every day the monthly RÚIAN check,
 * removal of observations older than 90 days and of expired administrator sessions.
 */
export interface Job {
  readonly name: string;
  readonly run: () => Promise<string>;
}

export function dbScript(name: string): string {
  return fileURLToPath(new URL(`../node_modules/@checkdrop/db/dist/${name}`, import.meta.url));
}

/** One line for the administration: a JSON result compacted, otherwise the last output line. */
export function summary(output: string): string {
  const text = output.trim();
  const start = text.lastIndexOf("\n{") + 1;
  try {
    return JSON.stringify(JSON.parse(text.slice(start))).slice(0, 300);
  } catch {
    return (text.split("\n").pop() ?? "").slice(0, 300);
  }
}

/** Runs a database command in its own process; resolves with a one-line summary of its output. */
export function runNodeScript(path: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    const keep = (current: string, chunk: Buffer) =>
      (current + chunk.toString("utf8")).slice(-4_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output = keep(output, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors = keep(errors, chunk);
      process.stderr.write(chunk);
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const last = (text: string) => text.trim().split("\n").pop() ?? "";
      if (code === 0) resolve(summary(output));
      else reject(new Error(last(errors) || `exited with ${signal ?? code}`));
    });
  });
}

export async function runJob(
  store: InstanceStatusStore,
  job: Job,
  now: () => Date = () => new Date(),
) {
  await store.jobStarted(job.name, now());
  try {
    const message = await job.run();
    await store.jobFinished(job.name, now(), true, message || null);
    process.stdout.write(`${JSON.stringify({ event: "job", name: job.name, ok: true })}\n`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.jobFinished(job.name, now(), false, message);
    process.stdout.write(
      `${JSON.stringify({ event: "job", name: job.name, ok: false, message })}\n`,
    );
    return false;
  }
}

/** Minutes after midnight UTC from "HH:MM"; 03:35 UTC by default, after ČÚZK's nightly publication. */
export function dailyMinute(value: string | undefined): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value?.trim() ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : 3 * 60 + 35;
}

export function isDue(now: Date, minute: number, lastRunDay: string | null): boolean {
  const day = now.toISOString().slice(0, 10);
  return day !== lastRunDay && now.getUTCHours() * 60 + now.getUTCMinutes() >= minute;
}

async function main() {
  const connectionString = process.env.CHECKDROP_DATABASE_URL;
  if (!connectionString) throw new Error("CHECKDROP_DATABASE_URL is required.");
  const status = createInstanceStatusStore(connectionString);
  const admins = createAdminAccountStore(connectionString);
  const minute = dailyMinute(process.env.CHECKDROP_JOBS_TIME);
  const addressUpdate: Job = {
    name: "address-data",
    run: () => runNodeScript(dbScript("update-ruian-cli.js"), 3 * 60 * 60 * 1_000),
  };
  const daily: Job[] = [
    addressUpdate,
    {
      name: "observation-cleanup",
      run: () => runNodeScript(dbScript("cleanup-shadow-observations-cli.js"), 30 * 60 * 1_000),
    },
    {
      name: "session-cleanup",
      run: async () => `removed ${await admins.deleteExpiredSessions(new Date())}`,
    },
  ];

  let stopping = false;
  let wake: (() => void) | null = null;
  let running: Promise<boolean> | null = null;
  // Registered first: as PID 1, Node would otherwise ignore SIGTERM during the first import.
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      stopping = true;
      wake?.();
      if (running === null) process.exit(0);
    });
  // A new installation gets its addresses without waiting for the first night.
  if (!(await status.activeAddressData())) {
    running = runJob(status, addressUpdate);
    await running;
    running = null;
  }

  // The daily run counts as done today only if it really finished today, not because we restarted.
  const cleanup = (await status.jobs()).find((job) => job.name === "observation-cleanup");
  let lastRunDay: string | null = cleanup?.finishedAt?.slice(0, 10) ?? null;
  while (!stopping) {
    const now = new Date();
    if (isDue(now, minute, lastRunDay)) {
      lastRunDay = now.toISOString().slice(0, 10);
      for (const job of daily) {
        if (stopping) break;
        running = runJob(status, job);
        await running;
        running = null;
      }
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  await Promise.all([status.close(), admins.close()]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
