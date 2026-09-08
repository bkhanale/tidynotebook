/**
 * Line comparison inside a Web Worker.
 *
 * This module is the worker side of history diffs. It runs
 * the editor's jsdiff comparison off the main thread and posts the mapped
 * `DiffHunk` records back. The main thread side in `diff-worker.ts` owns the
 * 500 ms budget and the limit handling; this file only compares and answers.
 *
 * The request and response shapes live in `diff-worker.ts` and are imported
 * as types only, so the worker bundle shares the protocol without a runtime
 * cycle. The comparison itself comes from `@notesapp/editor`, which is safe
 * to load without a document.
 */
import { compareLines } from '@notesapp/editor';
import type { DiffWorkerRequest, DiffWorkerResponse } from './diff-worker.ts';

/** Answers one comparison request with its mapped hunks or a limit. */
export default function handleDiffRequest(
  request: DiffWorkerRequest,
): DiffWorkerResponse {
  try {
    return {
      id: request.id,
      result: compareLines(request.before, request.after),
    };
  } catch {
    return { id: request.id, result: { kind: 'limit' } };
  }
}

self.onmessage = (event: MessageEvent<DiffWorkerRequest>): void => {
  self.postMessage(handleDiffRequest(event.data));
};
