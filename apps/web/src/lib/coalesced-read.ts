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

/** A coalesced read whose life follows the mounts of one screen. */
export type MountedRead = {
  /** Asks the read of the mount that runs. Before a mount it does nothing. */
  readonly ask: () => void;
  /** Starts the reads of one mount and answers how to stop them. */
  readonly mount: () => () => void;
};

/**
 * Builds a read that a screen creates once and mounts in its effect.
 *
 * React runs the effects of a screen twice in development (`StrictMode`):
 * it mounts, stops and mounts again. A read that the first stop ended for
 * good asked for nothing after it, so the screen stopped reading the store.
 * Each mount therefore gets a read of its own, and a stop ends only that one.
 */
export function createMountedRead(run: () => Promise<void>): MountedRead {
  let current: CoalescedRead | null = null;
  return {
    ask: () => {
      current?.ask();
    },
    mount: () => {
      const read = createCoalescedRead(run);
      current = read;
      return () => {
        read.stop();
        if (current === read) current = null;
      };
    },
  };
}
