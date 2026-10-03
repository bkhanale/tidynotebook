/**
 * When the open editor writes its draft to this device (record 0175).
 *
 * The keys do not wait for this schedule: each frame appends their work to
 * the document of the note (`note-work.ts`). The draft is recovery data of
 * the text and the name, and one write takes a burst of changes. It runs
 * after a pause in typing, and never later than `maxWaitMs` after the first
 * change that it holds, so a long burst still gets a draft while the person
 * types. A hidden tab and the end of the screen run the write at once, and a
 * version cancels it because the version writes the draft itself.
 *
 * The timer is injected, so a unit test drives the clock itself.
 */

/** The schedule of the draft writes of one open editor. */
export type WriteSchedule = {
  /** States that the editor holds a change that no draft holds yet. */
  readonly touch: () => void;
  /** Runs the write that waits now. Answers whether one waited. */
  readonly flush: () => boolean;
  /** Drops the write that waits, for a version that writes the draft. */
  readonly cancel: () => void;
  /** Whether the editor holds a change that no draft took yet. */
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
