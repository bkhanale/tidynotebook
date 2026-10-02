/**
 * One read that a burst of store changes asks for (record 0176).
 *
 * A change of the local store asks a screen to read again. A snapshot or a
 * feed page can announce many changes in one task, and a read that started
 * for each of them ran a thousand reads of the same rows at once, which held
 * IndexedDB and the main thread for seconds. This read runs at most once at
 * a time. An ask that arrives while it runs asks for one more run after it,
 * which sees every change before it, so no change is missed and a burst
 * costs two reads.
 */

/** A read that runs once at a time and once more for a burst of asks. */
export type CoalescedRead = {
  /** Asks for a read: now, or after the read that runs. */
  readonly ask: () => void;
  /** Stops the reads: a running read ends, and no later one starts. */
  readonly stop: () => void;
};

/** Builds the read around `run`, which must settle. */
export function createCoalescedRead(run: () => Promise<void>): CoalescedRead {
  let running = false;
  let again = false;
  let stopped = false;
  const start = (): void => {
    running = true;
    again = false;
    void run()
      .catch(() => {
        // The read reports its own failure. A failed read still lets the
        // next ask run.
      })
      .finally(() => {
        running = false;
        if (again && !stopped) start();
      });
  };
  return {
    ask: () => {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      start();
    },
    stop: () => {
      stopped = true;
      again = false;
    },
  };
}
