/**
 * Shared contract for live data providers such as DNS, ARES or VIES.
 *
 * - Concurrent calls with one key share a single provider request.
 * - Answers stay in a bounded, least-recently-used cache for as long as `ttlMs` allows; a TTL of
 *   zero keeps an answer out of the cache, which suits outages and invalid responses.
 * - Thrown errors are never cached and reach the caller, who turns them into an `unavailable`
 *   result. Nothing retries without a limit.
 * - When too many provider requests are open, `whenBusy` answers at once instead of queueing.
 */
export interface LiveLookupOptions<Args extends readonly unknown[], Value> {
  readonly now?: () => number;
  readonly ttlMs: (value: Value) => number;
  readonly maxEntries: number;
  readonly maxInFlight: number;
  readonly whenBusy: (...args: Args) => Value;
  /** Gives each caller its own copy, so no caller can change a cached answer. */
  readonly copy?: (value: Value) => Value;
}

export function createLiveLookup<Args extends readonly unknown[], Value>(
  lookup: (...args: Args) => Promise<Value>,
  keyOf: (...args: Args) => string,
  options: LiveLookupOptions<Args, Value>,
): (...args: Args) => Promise<Value> {
  const now = options.now ?? (() => performance.now());
  const copy = options.copy ?? ((value: Value) => value);
  const completed = new BoundedMap<string, { readonly expiresAt: number; readonly value: Value }>(
    options.maxEntries,
  );
  const inFlight = new Map<string, Promise<Value>>();

  return async (...args) => {
    const key = keyOf(...args);
    const cached = completed.get(key);
    if (cached) {
      if (cached.expiresAt > now()) return copy(cached.value);
      completed.delete(key);
    }
    const pending = inFlight.get(key);
    if (pending) return copy(await pending);
    if (inFlight.size >= options.maxInFlight) return options.whenBusy(...args);
    const request = lookup(...args)
      .then((value) => {
        const ttl = options.ttlMs(value);
        if (ttl > 0) completed.set(key, { expiresAt: now() + ttl, value: copy(value) });
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, request);
    return copy(await request);
  };
}

/** Map that keeps at most `maxEntries` items and drops the least recently used one first. */
export class BoundedMap<Key, Value> {
  // Map iteration order is insertion order; re-inserting on read keeps it least-recently-used.
  readonly #entries = new Map<Key, Value>();

  constructor(readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("BoundedMap maxEntries must be a positive integer.");
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: Key): Value | undefined {
    if (!this.#entries.has(key)) return undefined;
    const value = this.#entries.get(key) as Value;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: Key, value: Value): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
  }

  delete(key: Key): void {
    this.#entries.delete(key);
  }

  values(): IterableIterator<Value> {
    return this.#entries.values();
  }
}
