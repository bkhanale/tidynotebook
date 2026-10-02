# 0176. A save waits for no read

- Status: Accepted
- Date: 2026-10-02

## Context

The audit of 2026-10-02 measured about 260 ms in the client between Ctrl + S
and the request (issue 263), one save that reached a second device after
19.4 s and one move to All notes of 12.8 s (issue 267). `pnpm perf:save` and
the engine found these causes:

- Before its checkpoint the editor wrote the draft and read its queue state,
  the document and the checkpoints again, and the checkpoint writes the same
  draft in its own transaction.
- A pass of `packages/sync/src/engine.ts` read the session and then the
  protocol, then pushed, then pulled. A wake during the pull only asked for
  the next pass, and a first snapshot read every revision one at a time:
  about 20 s for 1003 notes after a reload in the first sync.
- The activation of a snapshot announced one change for each note and a
  feed page one for each change. Each listener read again for each one, so
  the file list read the whole area a thousand times and held IndexedDB and
  the main thread for seconds.
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
  at a time. It still runs to its activation, because a push inside it
  could move the accepted head of a note back to the snapshot.
- One transaction of many files announces one change with `fileId: null`.
  A purge stays a change of its file. A screen that reads again on a change
  runs one read at a time and one more after it (`lib/coalesced-read.ts`).
- A stream that closes wakes every engine, so each reads at once and then
  on the poll interval until a set is accepted again.

This refines records 0085, 0124 and 0130. It excludes a fixed delay before
an explicit save.

## Consequences

- A save waits at most for one feed page, or for the snapshot of a device
  that has no cursor yet.
- `engine.test.ts`, `notice-coordinator.test.ts`, `coalesced-read.test.ts`
  and `tests/integration/browser-storage.test.ts` hold each rule.
