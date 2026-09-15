/**
 * The idle bound of a streamed request body.
 *
 * A route that reads a large body cannot use a total time bound. A big file
 * over a slow link is not an attack, and a bound that cuts it makes the
 * feature unusable. What is an attack is a sender that holds a connection and
 * a request slot while it delivers almost nothing. The rule that separates the
 * two is idle time: the gap between one byte of the body and the next.
 *
 * So this module bounds the gap, not the whole. The watch is armed when the
 * route starts to read the body and it is rearmed on every chunk. When one gap
 * passes the bound, the route answers `408` with a stable problem code, which
 * the contract declares for that operation.
 *
 * The bound interacts with two other numbers, and both relations are held
 * elsewhere:
 *
 * - `requestTimeout` of `app.ts` is the total receive bound of the Node HTTP
 *   server, and it applies to every request. It must stay longer than this
 *   bound, or the total bound always fires first and answers with the bare
 *   `408` of the framework instead of a problem body. `config.ts` refuses a
 *   configuration that does not hold that relation.
 * - The stop deadline of `lifecycle.ts` bounds the drain. The grace period
 *   plus this bound stays inside that deadline, so a stop never ends before
 *   the server itself would have refused an idle body.
 *
 * Back pressure counts as idle, because a body that the route cannot write is
 * a body that is not arriving. The bound is far longer than any write of a
 * local file, so no real upload reaches it that way.
 */
import type { Readable } from 'node:stream';

/** A running watch. */
export type BodyIdleWatch = {
  /** Ends the watch. It is safe to call more than once. */
  readonly stop: () => void;
};

/**
 * The clock of the watch.
 *
 * `start` arms one timer and answers with the call that cancels it, so a test
 * drives the whole rule without waiting for real time.
 */
export type IdleTimers = {
  readonly start: (milliseconds: number, run: () => void) => () => void;
};

/** The clock of the running process. */
export const realIdleTimers: IdleTimers = {
  start: (milliseconds, run) => {
    // The timer never holds the event loop open. A request that ends first
    // stops the watch, and a process that has nothing else to do must exit.
    const handle = setTimeout(run, milliseconds);
    handle.unref();
    return (): void => {
      clearTimeout(handle);
    };
  },
};

/** What one watch needs. */
export type BodyIdleOptions = {
  /** The request body that the route reads. */
  readonly body: Readable;
  /** The longest gap between two chunks of that body. */
  readonly idleMs: number;
  /** Runs one time, when a gap passes the bound. */
  readonly onIdle: () => void;
  /** The clock. The process clock is the default. */
  readonly timers?: IdleTimers;
};

/**
 * Watches one request body and reports the first gap that passes the bound.
 *
 * The watch ends itself when the body ends, closes, or fails, and `onIdle`
 * runs at most one time. The caller still calls `stop` in its own cleanup, so
 * a route that leaves early leaves no armed timer behind.
 *
 * The watch listens for `data`, so the caller arms it after it starts to read
 * the body. A body that nothing reads yet would otherwise start to flow here
 * and lose its first chunks.
 */
export function watchBodyIdle(options: BodyIdleOptions): BodyIdleWatch {
  const timers = options.timers ?? realIdleTimers;
  let cancel: (() => void) | null = null;
  let ended = false;

  const disarm = (): void => {
    cancel?.();
    cancel = null;
  };

  const stop = (): void => {
    if (ended) return;
    ended = true;
    disarm();
    options.body.off('data', onData);
    options.body.off('end', stop);
    options.body.off('close', stop);
    options.body.off('error', stop);
  };

  const arm = (): void => {
    if (ended) return;
    cancel = timers.start(options.idleMs, () => {
      cancel = null;
      stop();
      options.onIdle();
    });
  };

  function onData(): void {
    disarm();
    arm();
  }

  options.body.on('data', onData);
  options.body.on('end', stop);
  options.body.on('close', stop);
  options.body.on('error', stop);
  arm();
  return { stop };
}
