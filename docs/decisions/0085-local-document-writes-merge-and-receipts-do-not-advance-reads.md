# 0085. Local document writes merge and receipts do not advance reads

- Status: Accepted
- Date: 2026-09-22

## Context

Two tabs can write before either reads the other's invalidation. A receipt
can also name remote text the client has not applied. Neither event permits
replacement of a working document. See
[design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- `packages/sync/src/local-port.ts` separates accepted and fully applied server
  state, the live document, unsaved work, immutable queued checkpoints, and
  receipts. `packages/storage-browser/src/local-store/` implements the port.
- Each local write merges updates with the latest stored document inside one
  IndexedDB transaction. No stale whole-document buffer replaces a shared row.
  Invalidation follows commit. A resumed tab reads durable missing work even
  when it missed every signal. The sender lease does not serialize all writers.
- A save freezes its text, complete observed state, and cumulative update since
  the last fully applied head. Its checkpoint cannot change when another tab
  edits. The first send freezes the exact request, including a batch, and its
  digest. Every retry uses that body until its outcome is known.
- A receipt confirms acceptance only. The client advances applied state after
  it has applied the matching document content through a coherent response or
  feed. Newer drafts and queued saves remain intact. Local and accepted History
  can therefore hold different text for the same save until reconciliation.
- A feed or snapshot transaction commits the document, head metadata, and cursor
  together. Snapshot activation preserves pending work. Apply duplicate records
  once, and never move a newer applied head backwards with an older receipt.
- Origins distinguish local edits from remote work and repair. A remote-only
  change does not schedule another save or enter local undo. Pure helpers own
  the dirty and settled checks; text equality is not operation equality.
- Recovery and uncertain receipts follow record 0084. Purge recovery follows
  record 0083 before any path removes the local draft.

## Consequences

- `tests/integration/browser-storage.test.ts` proves concurrent connections,
  missed signals, frozen checkpoints, and all-or-nothing writes.
- `tests/integration/sync.test.ts` proves a lost reply, a rejected predecessor,
  repeated batches, expired cursors, and snapshots with pending work. Faults at
  each durable boundary must leave a restartable state.
