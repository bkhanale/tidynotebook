/**
 * The attempt counter of this server, shared by every route of one group.
 *
 * The limit plugin already builds the key of an attempt from the caller and
 * the group name of the route, so two routes of one group ask about one key.
 * It then builds a child store for each route, and the store it ships gives
 * each child a map of its own, so the two keys landed in two maps and counted
 * apart. Measured with a limit of two: two attempts on the page form of a
 * published link, and the unlock operation still answered twice before it
 * refused. One caller therefore had four attempts at one password by moving
 * between the two paths.
 *
 * Every child here answers from one map, so the group is the bucket. Nothing
 * else changes: the key still carries the caller and the group, so two groups
 * and two callers stay apart.
 *
 * The counter lives in this process. A deployment that runs more than one
 * instance needs a shared counter, which the plugin supports through its
 * Redis store, and this file is where that choice would be made.
 */

/** What one key holds right now. */
type Attempt = {
  current: number;
  /** Milliseconds until the window of this key ends. */
  ttl: number;
  /** When the window of this key started, in milliseconds. */
  startedMs: number;
};

/** The result the limit plugin reads back. */
export type AttemptState = { readonly current: number; readonly ttl: number };

/** The callback shape of the limit plugin. */
type AttemptCallback = (error: Error | null, result?: AttemptState) => void;

/**
 * How many keys one server holds.
 *
 * The map is bounded, so a caller that invents keys cannot grow it without
 * end. The oldest key goes first, which costs that caller nothing: a key that
 * left the map starts its window again, and a window is a minute.
 */
export const maxAttemptKeys = 20_000;

/** One counter map, which every child of one store shares. */
export class AttemptCounters {
  private readonly keys = new Map<string, Attempt>();

  /** Counts one attempt against `key` and answers the state after it. */
  count(key: string, timeWindow: number, now: number): AttemptState {
    const held = this.keys.get(key);
    if (held === undefined || held.startedMs + timeWindow <= now) {
      const started: Attempt = { current: 1, ttl: timeWindow, startedMs: now };
      this.keys.delete(key);
      this.keys.set(key, started);
      this.evict();
      return { current: started.current, ttl: started.ttl };
    }
    held.current += 1;
    held.ttl = timeWindow - (now - held.startedMs);
    // The key moves to the end, so the oldest key is the first to go.
    this.keys.delete(key);
    this.keys.set(key, held);
    return { current: held.current, ttl: held.ttl };
  }

  /** Answers the state of `key` without counting an attempt against it. */
  read(key: string, timeWindow: number, now: number): AttemptState {
    const held = this.keys.get(key);
    if (held === undefined || held.startedMs + timeWindow <= now)
      return { current: 0, ttl: 0 };
    return { current: held.current, ttl: timeWindow - (now - held.startedMs) };
  }

  /** How many keys the map holds. The bound of this map is tested by it. */
  get size(): number {
    return this.keys.size;
  }

  private evict(): void {
    while (this.keys.size > maxAttemptKeys) {
      const oldest = this.keys.keys().next();
      if (oldest.done === true) return;
      this.keys.delete(oldest.value);
    }
  }
}

/**
 * An attempt store for the limit plugin.
 *
 * The plugin builds it once with `new`, then calls `child` for each route that
 * carries a limit. Every child answers from the counters of the store it came
 * from, which is the whole point of this file.
 */
export class SharedAttemptStore {
  readonly #counters: AttemptCounters;
  readonly #now: () => number;

  /**
   * The plugin builds this store with its own options object, which carries
   * neither member below, so the store it builds owns fresh counters and the
   * system clock. `child` passes both on, which is what shares them.
   */
  constructor(options?: {
    readonly now?: (() => number) | undefined;
    readonly counters?: AttemptCounters | undefined;
  }) {
    this.#counters = options?.counters ?? new AttemptCounters();
    this.#now = options?.now ?? ((): number => Date.now());
  }

  /** Counts one attempt. The signature is the one the plugin calls. */
  incr(key: string, callback: AttemptCallback, timeWindow: number): void {
    callback(null, this.#counters.count(key, timeWindow, this.#now()));
  }

  /** Reads the state of a key without counting an attempt against it. */
  read(key: string, callback: AttemptCallback, timeWindow: number): void {
    callback(null, this.#counters.read(key, timeWindow, this.#now()));
  }

  /** The store of one route, which shares the counters of this one. */
  child(): SharedAttemptStore {
    return new SharedAttemptStore({
      now: this.#now,
      counters: this.#counters,
    });
  }

  /** How many keys this store holds. The bound of the map is tested by it. */
  get keyCount(): number {
    return this.#counters.size;
  }
}
