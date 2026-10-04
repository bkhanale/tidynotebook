/**
 * The writes of the sums of one process (record 0193).
 *
 * Each process writes the sums of its meter to the monthly table every
 * `usageWriteIntervalMs`, and once more when it stops, so a stop loses no
 * count that the process made. A write that fails keeps its sums for the
 * next one and tells `failed`, so the operator reads it in the log.
 */
import {
  createUsageMeter,
  noUsageCaps,
  zeroCounts,
  type MonthlyUsageStore,
  type UsageMeter,
} from '@notesapp/core';

/** How often a process writes its sums, in milliseconds. */
export const usageWriteIntervalMs = 10_000;

/** The writes of one meter, and the stop that writes the last sums. */
export type UsageWrites = {
  /** Stops the timer and writes what the meter still holds. */
  stop(): Promise<void>;
};

/**
 * Starts the timer of the writes of one meter.
 *
 * The timer holds no process open, because the stop writes the last sums.
 */
export function startUsageWrites(
  meter: UsageMeter,
  intervalMs: number,
  failed: () => void,
): UsageWrites {
  const write = (): Promise<void> => meter.flush().catch(failed);
  const timer = setInterval(() => void write(), intervalMs);
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await write();
    },
  };
}

/**
 * Closes a process so that its last sums are written whatever fails.
 *
 * `close` runs first, so the sums hold every answer and every call that it
 * counts. The last write runs next, even when `close` fails, and `after`
 * closes the store of the counts behind it. A failure of `close` still
 * reaches the caller.
 */
export async function closeWithLastWrite(
  close: () => Promise<void>,
  writes: UsageWrites,
  after: () => Promise<void>,
): Promise<void> {
  try {
    await close();
  } finally {
    try {
      await writes.stop();
    } finally {
      await after();
    }
  }
}

/**
 * A store that keeps nothing, for a server that a test builds with no
 * database. Every month reads zero, and no account has a limit.
 */
export const unmeteredStore: MonthlyUsageStore = {
  addUsage: () => Promise.resolve(),
  usageSubject: () => Promise.resolve(null),
  storedUsage: () =>
    Promise.resolve({ account: zeroCounts, installation: zeroCounts }),
};

/** The meter of a server that a test builds with no database. */
export function unmeteredUsage(): UsageMeter {
  return createUsageMeter({
    store: unmeteredStore,
    caps: noUsageCaps,
    clock: () => new Date(),
    subjectTtlMs: 0,
  });
}
