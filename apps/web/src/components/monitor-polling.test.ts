import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMonitorPolling } from "./monitor-polling";

describe("monitor polling lifecycle", () => {
  let page: EventTarget & { hidden: boolean };
  let network: { onLine: boolean };
  let browser: EventTarget;
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { hidden: false });
    browser = new EventTarget();
    network = { onLine: true };
    vi.stubGlobal("document", page);
    vi.stubGlobal("window", browser);
    vi.stubGlobal("navigator", network);
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("pauses while hidden/offline, refreshes on return and cancels on disposal", async () => {
    const load = vi.fn(async () => "data");
    const receive = vi.fn();
    stop = startMonitorPolling({ load, receive, fail: vi.fn(), refreshing: vi.fn() });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(2);
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(2);
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
    network.onLine = false;
    browser.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(3);
    network.onLine = true;
    browser.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(receive).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("ignores a late response from an aborted request even if the transport ignores abort", async () => {
    const resolvers: ((value: number) => void)[] = [];
    const receive = vi.fn();
    stop = startMonitorPolling({
      load: () => new Promise<number>((resolve) => resolvers.push(resolve)),
      receive,
      fail: vi.fn(),
      refreshing: vi.fn(),
    });
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    resolvers[1]?.(2);
    await vi.advanceTimersByTimeAsync(0);
    resolvers[0]?.(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(receive.mock.calls).toEqual([[2]]);
  });

  it("backs off after errors without replacing valid data and resets after recovery", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce("initial")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("recovered");
    const receive = vi.fn();
    const fail = vi.fn();
    stop = startMonitorPolling({ load, receive, fail, refreshing: vi.fn() });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(receive.mock.calls).toEqual([["initial"]]);
    expect(fail).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(receive.mock.calls).toEqual([["initial"], ["recovered"]]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
