import { readFile } from "node:fs/promises";

/** What the host-side updater last recorded; written by `checkdrop update` into state/update.json. */
export interface UpdateState {
  readonly auto_update: boolean;
  readonly channel: string;
  readonly latest_version: string | null;
  readonly checked_at: string | null;
  readonly last_update: {
    readonly state: "succeeded" | "rolled_back" | "failed";
    readonly from: string;
    readonly to: string;
    readonly at: string;
    readonly message: string | null;
  } | null;
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,40})?$/;
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max ? value : null;
const timestamp = (value: unknown) => {
  const raw = text(value, 40);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
};

/** Reads only known fields, so a damaged or foreign file never reaches the administration as-is. */
export function parseUpdateState(raw: unknown): UpdateState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const latest = text(value.latest_version, 60);
  const last = value.last_update as Record<string, unknown> | null | undefined;
  const lastState = last?.state;
  return {
    auto_update: value.auto_update === true,
    channel: text(value.channel, 20) ?? "stable",
    latest_version: latest && VERSION.test(latest) ? latest : null,
    checked_at: timestamp(value.checked_at),
    last_update:
      last &&
      (lastState === "succeeded" || lastState === "rolled_back" || lastState === "failed") &&
      typeof last.from === "string" &&
      typeof last.to === "string" &&
      VERSION.test(last.from) &&
      VERSION.test(last.to) &&
      timestamp(last.at)
        ? {
            state: lastState,
            from: last.from,
            to: last.to,
            at: timestamp(last.at) as string,
            message: text(last.message, 300),
          }
        : null,
  };
}

export async function readUpdateState(
  path = process.env.CHECKDROP_UPDATE_STATE_FILE ?? "/run/checkdrop/update.json",
): Promise<UpdateState | null> {
  try {
    return parseUpdateState(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

/** True when `candidate` is a newer release than `current`; pre-releases sort before releases. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => {
    const [core = "", pre] = version.split("-", 2);
    return { parts: core.split(".").map(Number), pre: pre ?? null };
  };
  const a = parse(candidate);
  const b = parse(current);
  if (![...a.parts, ...b.parts].every(Number.isFinite)) return false;
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  if (a.pre === b.pre) return false;
  if (a.pre === null) return true;
  if (b.pre === null) return false;
  return a.pre > b.pre;
}
