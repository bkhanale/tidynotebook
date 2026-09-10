/**
 * Line comparison in a Web Worker with a responsiveness budget.
 *
 * History screens compare the current version against an old revision
 * through {@link requestDiff}. The jsdiff comparison
 * itself lives in `@notesapp/editor` and runs inside the worker below, so a
 * large comparison never blocks typing or rendering. The worker source is
 * bundled from `diff-worker-impl.ts` through Vite's worker import; the
 * comparison result is already mapped to `DiffHunk` records when it arrives.
 *
 * Budget rules:
 *
 * - Texts larger than {@link maxWorkerDiffBytes} together resolve to a limit
 *   without spawning a worker.
 * - A worker that answers within {@link diffWorkerTimeoutMs} resolves to its
 *   complete hunks or its own limit.
 * - A worker that exceeds the budget is terminated and the request resolves
 *   to a limit. The screens then show a message and offer explicit
 *   whole-version selection or source editing while retaining both versions.
 * - A worker that fails to start, or an environment without workers, falls
 *   back to the same bounded comparison on the calling thread.
 */
import { compareLines, type DiffResult } from '@notesapp/editor';
import DiffWorker from './diff-worker-impl.ts?worker';

/** The worker budget in milliseconds. */
export const diffWorkerTimeoutMs = 500;

/** The largest combined text size, in UTF-8 bytes, sent to the worker. */
export const maxWorkerDiffBytes = 1_000_000;

/** One comparison request of the worker protocol. */
export type DiffWorkerRequest = {
  readonly id: number;
  readonly before: string;
  readonly after: string;
};

/** One comparison answer of the worker protocol. */
export type DiffWorkerResponse = {
  readonly id: number;
  readonly result: DiffResult;
};

/** The UTF-8 byte length of a text. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** True when this environment can spawn a worker. */
function isWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Compares two texts line by line without blocking the caller.
 *
 * Resolves to complete hunks when the worker answers in budget, and to a
 * limit when the texts are too large, the worker exceeds its budget, or the
 * comparison itself gives up. Never rejects.
 */
export function requestDiff(
  before: string,
  after: string,
): Promise<DiffResult> {
  if (!isWorkerAvailable()) {
    try {
      return Promise.resolve(compareLines(before, after));
    } catch {
      return Promise.resolve({ kind: 'limit' });
    }
  }
  if (byteLength(before) + byteLength(after) > maxWorkerDiffBytes)
    return Promise.resolve({ kind: 'limit' });
  return new Promise<DiffResult>((resolve) => {
    let settled = false;
    const finish = (result: DiffResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        worker.terminate();
      } catch {
        // Termination is best effort once the answer is recorded.
      }
      resolve(result);
    };
    let worker: Worker;
    try {
      worker = new DiffWorker();
    } catch {
      try {
        resolve(compareLines(before, after));
      } catch {
        resolve({ kind: 'limit' });
      }
      return;
    }
    const timer = window.setTimeout(() => {
      finish({ kind: 'limit' });
    }, diffWorkerTimeoutMs);
    worker.onmessage = (event: MessageEvent<DiffWorkerResponse>): void => {
      const response = event.data;
      if (
        response === null ||
        typeof response !== 'object' ||
        response.id !== 1
      )
        return;
      finish(response.result);
    };
    worker.onerror = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        worker.terminate();
      } catch {
        // Termination is best effort once the fallback is chosen.
      }
      try {
        resolve(compareLines(before, after));
      } catch {
        resolve({ kind: 'limit' });
      }
    };
    try {
      const request: DiffWorkerRequest = { id: 1, before, after };
      worker.postMessage(request);
    } catch {
      finish({ kind: 'limit' });
    }
  });
}

/** One pair of texts of a series comparison. */
export type DiffPair = {
  readonly before: string;
  readonly after: string;
};

/**
 * Compares a series of pairs in one worker.
 *
 * The history timeline needs a summary for every listed version, which is
 * one comparison per neighbouring pair. Spawning a worker for each of them
 * costs more than the comparisons themselves, so the series shares one
 * worker and answers in order. Every pair keeps the same budget as a single
 * comparison; a pair that passes it resolves to a limit and the series goes
 * on with the next one. Never rejects.
 */
export async function requestDiffSeries(
  pairs: readonly DiffPair[],
): Promise<readonly DiffResult[]> {
  if (pairs.length === 0) return [];
  if (!isWorkerAvailable()) return pairs.map(compareOnThisThread);
  let worker: Worker;
  try {
    worker = new DiffWorker();
  } catch {
    return pairs.map(compareOnThisThread);
  }
  try {
    const results: DiffResult[] = [];
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[index];
      if (pair === undefined) continue;
      results.push(await answerOf(worker, index + 1, pair));
    }
    return results;
  } finally {
    try {
      worker.terminate();
    } catch {
      // Termination is best effort once every answer is recorded.
    }
  }
}

/** Compares one pair on the calling thread, within the same bound. */
function compareOnThisThread(pair: DiffPair): DiffResult {
  try {
    return compareLines(pair.before, pair.after);
  } catch {
    return { kind: 'limit' };
  }
}

/** Waits for the answer of one request of a series, inside the budget. */
function answerOf(
  worker: Worker,
  id: number,
  pair: DiffPair,
): Promise<DiffResult> {
  if (byteLength(pair.before) + byteLength(pair.after) > maxWorkerDiffBytes)
    return Promise.resolve({ kind: 'limit' });
  return new Promise<DiffResult>((resolve) => {
    let settled = false;
    const finish = (result: DiffResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      resolve(result);
    };
    const timer = window.setTimeout(() => {
      finish({ kind: 'limit' });
    }, diffWorkerTimeoutMs);
    worker.onmessage = (event: MessageEvent<DiffWorkerResponse>): void => {
      const response = event.data;
      if (
        response === null ||
        typeof response !== 'object' ||
        response.id !== id
      )
        return;
      finish(response.result);
    };
    worker.onerror = (): void => {
      finish(compareOnThisThread(pair));
    };
    try {
      const request: DiffWorkerRequest = {
        id,
        before: pair.before,
        after: pair.after,
      };
      worker.postMessage(request);
    } catch {
      finish({ kind: 'limit' });
    }
  });
}
