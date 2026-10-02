/**
 * When the open editor writes its work to this device (record 0175).
 *
 * A key writes nothing. The editor holds the work of a burst of keys in its
 * document and in its buffer, and one local write takes both: the document
 * work and the draft. The write runs after a pause in typing, and never later
 * than `maxWaitMs` after the first key that it holds, so a long burst still
 * reaches storage while the person types and a crash loses that much at most.
 * A save, a hidden tab and the end of the screen run the write at once.
 *
 * The timer is injected, so a unit test drives the clock itself.
 */

/** The schedule of the local writes of one open editor. */
export type WriteSchedule = {
  /** States that the editor holds work the store does not have yet. */
  readonly touch: () => void;
  /** Runs the write that waits now. Answers whether one waited. */
  readonly flush: () => boolean;
  /** Drops the write that waits, for a note that leaves the screen. */
  readonly cancel: () => void;
  /** Whether the editor holds work that no write took yet. */
  readonly waiting: () => boolean;
};

/** What the schedule needs, injected so a test controls time. */
export type WriteScheduleOptions<Token> = {
  /** The pause in typing that starts the write. */
  readonly pauseMs: number;
  /** The longest time the first held key waits for its write. */
  readonly maxWaitMs: number;
  readonly now: () => number;
  readonly defer: (run: () => void, delayMs: number) => Token;
  readonly cancel: (token: Token) => void;
  /** The write itself. It reads the work that the editor holds when it runs. */
  readonly write: () => void;
};

/** Builds the schedule of one open editor. */
export function createWriteSchedule<Token>(
  options: WriteScheduleOptions<Token>,
): WriteSchedule {
  let timer: Token | null = null;
  // When the first key that no write took arrived, or `null` with none.
  let heldSince: number | null = null;

  const clear = (): void => {
    if (timer === null) return;
    options.cancel(timer);
    timer = null;
  };

  const run = (): void => {
    clear();
    heldSince = null;
    options.write();
  };

  return {
    touch: () => {
      const now = options.now();
      heldSince ??= now;
      clear();
      const latest = heldSince + options.maxWaitMs - now;
      timer = options.defer(
        run,
        Math.max(0, Math.min(options.pauseMs, latest)),
      );
    },
    flush: () => {
      if (heldSince === null) return false;
      run();
      return true;
    },
    cancel: () => {
      clear();
      heldSince = null;
    },
    waiting: () => heldSince !== null,
  };
}
