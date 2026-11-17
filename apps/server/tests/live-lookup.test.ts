import { describe, expect, it, vi } from "vitest";
import { BoundedMap, createLiveLookup } from "../src/providers/live-lookup.js";

describe("live data lookup", () => {
  const options = {
    ttlMs: (value: string) => (value === "down" ? 0 : 1_000),
    maxEntries: 2,
    maxInFlight: 2,
    whenBusy: (key: string) => `busy:${key}`,
  };

  it("shares one request between concurrent callers and caches the answer until its TTL", async () => {
    let now = 0;
    const lookup = vi.fn(async (key: string) => `value:${key}`);
    const cached = createLiveLookup(lookup, (key: string) => key, { ...options, now: () => now });
    expect(await Promise.all([cached("a"), cached("a"), cached("a")])).toEqual(
      Array(3).fill("value:a"),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    now = 1_001;
    await cached("a");
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("never caches an outage or a thrown error", async () => {
    const lookup = vi
      .fn<(key: string) => Promise<string>>()
      .mockResolvedValueOnce("down")
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("up");
    const cached = createLiveLookup(lookup, (key: string) => key, options);
    expect(await cached("a")).toBe("down");
    await expect(cached("a")).rejects.toThrow("timeout");
    expect(await cached("a")).toBe("up");
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("answers at once when too many provider requests are open", async () => {
    const pending: (() => void)[] = [];
    const lookup = (key: string) =>
      new Promise<string>((resolve) => pending.push(() => resolve(key)));
    const cached = createLiveLookup(lookup, (key: string) => key, options);
    const first = cached("a");
    const second = cached("b");
    expect(await cached("c")).toBe("busy:c");
    for (const release of pending) release();
    expect(await Promise.all([first, second])).toEqual(["a", "b"]);
  });

  it("keeps at most maxEntries answers and drops the least recently used", async () => {
    const lookup = vi.fn(async (key: string) => key);
    const cached = createLiveLookup(lookup, (key: string) => key, options);
    await cached("a");
    await cached("b");
    await cached("a");
    await cached("c");
    lookup.mockClear();
    await cached("a");
    await cached("b");
    expect(lookup.mock.calls).toEqual([["b"]]);
  });
});

describe("bounded map", () => {
  it("drops the least recently used entry", () => {
    const map = new BoundedMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    expect(map.get("a")).toBe(1);
    map.set("c", 3);
    expect([...map.values()]).toEqual([1, 3]);
    expect(map.get("b")).toBeUndefined();
  });

  it("rejects a size that is not a positive integer", () => {
    expect(() => new BoundedMap(0)).toThrow();
  });
});
