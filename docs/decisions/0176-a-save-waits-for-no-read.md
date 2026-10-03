# 0176. A save waits for no read

- Status: Accepted
- Date: 2026-10-02

## Context

The audit of 2026-10-02 found that most of the time between Ctrl + S and the
request was spent in the client (issue 263), and one save that reached a
second device after many seconds and one slow move to All notes (issue 267).
`pnpm perf:save` and the engine found these causes:

- Before its checkpoint the editor wrote the draft and read its queue state,
  the document and the checkpoints again, and the checkpoint writes the same
  draft in its own transaction.
- A pass of `packages/sync/src/engine.ts` read the session and then the
  protocol, then pushed, then pulled. A wake during the pull only asked for
  the next pass, and a first snapshot read every revision one at a time, so
  a save of a device in its first sync waited for all of them.
- The activation of a snapshot announced one change for each note and a
  feed page one for each change. Each listener read again for each one, so
  the file list read the whole area once for each note and held IndexedDB
  and the main thread.
- A stream that closed left every engine on the long safety rest of an
  accepted set until the stream came back (record 0131).

## Decision

- An explicit save checkpoints at once. The checkpoint writes the draft,
  and the queue read of the screen follows the checkpoint. The work of the
  open document is written first (record 0175).
- A pass reads the session and the protocol at the same time, and pushes
  nothing before both answer (records 0086, 0113).
- A pull turn ends between two feed pages when a save waits, so the next
  pass pushes first. A snapshot reads `snapshotFetchConcurrency` revisions
  at a time, and a save that waits stops its reads before the next one. The
  snapshot never activates after such a push, which could move an accepted
  head back: the next pass stages a new snapshot, and `stageSnapshot` gives
  it every revision that an earlier staging of the same owner stored, so no
  revision is read twice. A plan belongs to the engine that staged it, so a
  staging never removes a plan that another tab still fills. A reload during
  a first sync resumes the same way.
- One transaction of many files announces one change with `fileId: null`.
  A purge stays a change of its file. A screen that reads again on a change
  runs one read at a time and one more after it (`lib/coalesced-read.ts`).
- A stream that closes wakes every engine after a short random wait, so the
  devices of a server that restarts do not all read at once, and each then
  reads on the poll interval until a set is accepted again.

This refines records 0085, 0124 and 0130. It excludes a fixed delay before
an explicit save.

## Consequences

- A save waits at most for the request that runs: one feed page, the
  revisions in flight of a snapshot, or the start and the listing of a
  snapshot, which are single requests that are not stopped. Each of them
  ends with its answer or with the retry bound of `sendWithRetry`.
- `engine.test.ts`, `notice-coordinator.test.ts`, `coalesced-read.test.ts`
  and `tests/integration/browser-storage.test.ts` hold each rule.
