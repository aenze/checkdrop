import { describe, expect, it } from "vitest";
import { dailyMinute, isDue, runJob, summary } from "../src/jobs.js";

describe("installation jobs", () => {
  it("reads the daily time and falls back to 03:35 UTC", () => {
    expect(dailyMinute("04:10")).toBe(250);
    expect(dailyMinute(undefined)).toBe(215);
    expect(dailyMinute("25:00")).toBe(215);
  });

  it("runs once a day after the configured time", () => {
    const minute = dailyMinute("03:35");
    expect(isDue(new Date("2026-11-12T03:34:00Z"), minute, null)).toBe(false);
    expect(isDue(new Date("2026-11-12T03:35:00Z"), minute, null)).toBe(true);
    expect(isDue(new Date("2026-11-12T23:00:00Z"), minute, "2026-11-12")).toBe(false);
    expect(isDue(new Date("2026-11-13T03:40:00Z"), minute, "2026-11-12")).toBe(true);
  });

  it("records success and failure for the administration", async () => {
    const calls: unknown[][] = [];
    const store = {
      jobStarted: async (...args: unknown[]) => void calls.push(["started", ...args]),
      jobFinished: async (...args: unknown[]) => void calls.push(["finished", ...args]),
    };
    const at = () => new Date("2026-11-12T03:35:00Z");
    expect(await runJob(store as never, { name: "ok", run: async () => "done" }, at)).toBe(true);
    expect(
      await runJob(
        store as never,
        {
          name: "broken",
          run: async () => {
            throw new Error("ČÚZK unavailable");
          },
        },
        at,
      ),
    ).toBe(false);
    expect(calls.filter((call) => call[0] === "finished")).toEqual([
      ["finished", "ok", at(), true, "done"],
      ["finished", "broken", at(), false, "ČÚZK unavailable"],
    ]);
  });

  it("keeps a one-line summary of a command's output", () => {
    expect(
      summary('{"event":"progress"}\n{\n  "status": "activated",\n  "rowCount": 3023704\n}\n'),
    ).toBe('{"status":"activated","rowCount":3023704}');
    expect(summary("first\nNo newer snapshot\n")).toBe("No newer snapshot");
  });
});
