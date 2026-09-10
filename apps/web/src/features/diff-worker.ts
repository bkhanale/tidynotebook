/**
 * Line comparison in a Web Worker with a responsiveness budget.
 *
 * The history screen compares versions through {@link requestDiff} for one
 * pair and {@link requestDiffSeries} for a whole page of rows. The jsdiff
 * comparison itself lives in `@notesapp/editor` and runs inside the worker
 * below, so a large comparison never blocks typing or rendering. The worker
 * source is bundled from `diff-worker-impl.ts` through Vite's worker import;
 * the comparison result is already mapped to `DiffHunk` records when it
 * arrives.
 *
 * One request carries every pair of a call, and one answer carries every
 * outcome. A worker therefore starts once per call, answers once, and is
 * terminated, which keeps the module of the worker out of the way of the
 * rest of the session.
 *
 * Budget rules:
 *
 * - Pairs larger than {@link maxWorkerDiffBytes} together resolve to a limit
 *   without spawning a worker.
 * - A worker that answers within its budget resolves to complete hunks or to
 *   its own limit. The budget is {@link diffWorkerTimeoutMs} for one pair and
 *   grows with the number of pairs up to {@link maxDiffSeriesTimeoutMs}.
 * - A worker that exceeds the budget is terminated and every unanswered pair
 *   resolves to a limit. The screen then shows a message and offers whole
 *   version selection instead of hunk reading.
 * - A worker that fails to start, or an environment without workers, falls
 *   back to the same bounded comparison on the calling thread.
 */
import { compareLines, type DiffResult } from '@notesapp/editor';
import DiffWorker from './diff-worker-impl.ts?worker';

/** The budget of one pair, in milliseconds. */
export const diffWorkerTimeoutMs = 500;

/** The largest budget of one series, in milliseconds. */
export const maxDiffSeriesTimeoutMs = 5000;

/** The largest combined text size, in UTF-8 bytes, sent to the worker. */
export const maxWorkerDiffBytes = 1_000_000;

/** One pair of texts to compare. */
export type DiffPair = {
  readonly before: string;
  readonly after: string;
};

/** One comparison request of the worker protocol. */
export type DiffWorkerRequest = {
  readonly id: number;
  readonly pairs: readonly DiffPair[];
};

/** One comparison answer of the worker protocol, one outcome per pair. */
export type DiffWorkerResponse = {
  readonly id: number;
  readonly results: readonly DiffResult[];
};

/** The UTF-8 byte length of a text. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** True when this environment can spawn a worker. */
function isWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

/** Compares one pair on the calling thread, inside the same bound. */
function compareOnThisThread(pair: DiffPair): DiffResult {
  try {
    return compareLines(pair.before, pair.after);
  } catch {
    return { kind: 'limit' };
  }
}

/** The combined size of every pair, in UTF-8 bytes. */
function seriesBytes(pairs: readonly DiffPair[]): number {
  let bytes = 0;
  for (const pair of pairs)
    bytes += byteLength(pair.before) + byteLength(pair.after);
  return bytes;
}

/**
 * Compares a series of pairs without blocking the caller.
 *
 * Resolves to one outcome per pair, in the order the pairs were given.
 * Resolves to a limit for every pair when the series is too large, the
 * worker exceeds its budget, or the comparison itself gives up. Never
 * rejects.
 */
export function requestDiffSeries(
  pairs: readonly DiffPair[],
): Promise<readonly DiffResult[]> {
  if (pairs.length === 0) return Promise.resolve([]);
  if (!isWorkerAvailable())
    return Promise.resolve(pairs.map(compareOnThisThread));
  if (seriesBytes(pairs) > maxWorkerDiffBytes)
    return Promise.resolve(pairs.map(limitOf));
  const budget = Math.min(
    diffWorkerTimeoutMs * pairs.length,
    maxDiffSeriesTimeoutMs,
  );
  return new Promise<readonly DiffResult[]>((resolve) => {
    let settled = false;
    const finish = (results: readonly DiffResult[]): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        worker.terminate();
      } catch {
        // Termination is best effort once the answer is recorded.
      }
      resolve(results);
    };
    let worker: Worker;
    try {
      worker = new DiffWorker();
    } catch {
      resolve(pairs.map(compareOnThisThread));
      return;
    }
    const timer = window.setTimeout(() => {
      finish(pairs.map(limitOf));
    }, budget);
    worker.onmessage = (event: MessageEvent<DiffWorkerResponse>): void => {
      const response = event.data;
      if (
        response === null ||
        typeof response !== 'object' ||
        response.id !== 1 ||
        !Array.isArray(response.results)
      )
        return;
      finish(
        pairs.map((pair, index) => response.results[index] ?? limitOf(pair)),
      );
    };
    worker.onerror = (): void => {
      finish(pairs.map(compareOnThisThread));
    };
    try {
      const request: DiffWorkerRequest = { id: 1, pairs };
      worker.postMessage(request);
    } catch {
      finish(pairs.map(limitOf));
    }
  });
}

/** The limit outcome of one pair. */
function limitOf(_pair: DiffPair): DiffResult {
  return { kind: 'limit' };
}

/**
 * Compares two texts line by line without blocking the caller.
 *
 * Resolves to complete hunks when the worker answers in budget, and to a
 * limit when the texts are too large, the worker exceeds its budget, or the
 * comparison itself gives up. Never rejects.
 */
export async function requestDiff(
  before: string,
  after: string,
): Promise<DiffResult> {
  const results = await requestDiffSeries([{ before, after }]);
  return results[0] ?? { kind: 'limit' };
}
