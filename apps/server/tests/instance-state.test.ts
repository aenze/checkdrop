import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { isNewerVersion, parseUpdateState } from "../src/instance-state.js";

describe("update state from the host updater", () => {
  it("keeps only known, well-formed fields", () => {
    expect(
      parseUpdateState({
        auto_update: true,
        channel: "stable",
        latest_version: "0.2.0",
        checked_at: "2026-11-12T03:00:00Z",
        last_update: {
          state: "rolled_back",
          from: "0.1.0",
          to: "0.2.0",
          at: "2026-11-12T03:05:00Z",
          message: "health check failed",
          secret: "x",
        },
        extra: "<script>",
      }),
    ).toEqual({
      auto_update: true,
      channel: "stable",
      latest_version: "0.2.0",
      checked_at: "2026-11-12T03:00:00.000Z",
      last_update: {
        state: "rolled_back",
        from: "0.1.0",
        to: "0.2.0",
        at: "2026-11-12T03:05:00.000Z",
        message: "health check failed",
      },
    });
    expect(parseUpdateState({ latest_version: "evil; rm -rf /" })?.latest_version).toBeNull();
    expect(parseUpdateState("nonsense")).toBeNull();
  });

  it.each([
    ["0.2.0", "0.1.9", true],
    ["0.10.0", "0.9.0", true],
    ["1.0.0", "1.0.0", false],
    ["1.0.0", "1.0.0-rc.1", true],
    ["1.0.0-rc.1", "1.0.0", false],
    ["0.1.0", "0.2.0", false],
  ])("%s is newer than %s: %s", (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
  });
});

describe("installation status for the administration", () => {
  it("reports version, update and address data without customer data", async () => {
    const previousRelease = process.env.CHECKDROP_RELEASE;
    process.env.CHECKDROP_RELEASE = "0.1.0";
    const app = createApp({
      pilotStore: null,
      integrationStore: {} as never,
      operatorToken: "operator-secret-value-0123456789abcdef",
      operatorProjectRef: "default",
      adminAccountStore: null,
      instanceStatusStore: {
        activeAddressData: async () => null,
        jobs: async () => [
          {
            name: "address-data",
            state: "running",
            startedAt: "2026-11-12T10:00:00.000Z",
            finishedAt: null,
            message: null,
          },
        ],
        jobStarted: async () => {},
        jobFinished: async () => {},
        close: async () => {},
      },
      readUpdateState: async () =>
        parseUpdateState({ auto_update: true, latest_version: "9.0.0", channel: "stable" }),
    });
    if (previousRelease === undefined) delete process.env.CHECKDROP_RELEASE;
    else process.env.CHECKDROP_RELEASE = previousRelease;
    const anonymous = await app.request("/v1/operator/instance");
    expect(anonymous.status).toBe(401);
    const response = await app.request("/v1/operator/instance", {
      headers: { "X-Checkdrop-Operator-Key": "operator-secret-value-0123456789abcdef" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "instance",
      version: "0.1.0",
      update: { auto_update: true, latest_version: "9.0.0", available: true },
      address_data: { state: "importing", version: null },
      jobs: [{ name: "address-data", state: "running" }],
    });
  });
});
