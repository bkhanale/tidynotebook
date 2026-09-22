# 0081. Accepted text and observed state belong to one document

- Status: Accepted
- Date: 2026-09-22

## Context

Record 0076 uses state vectors to detect unseen work. Yjs does not advance
them for deletions. `expandMovedReferences` in
`packages/storage-server/src/workspace-store/portable-links.ts` also writes
text outside the proposed document path. See
[design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- A note holds one Yjs document. A save carries its update, epoch, and observed
  state. Observed state includes the vector and deletion set, scoped to the
  note and epoch. A vector alone serves delta encoding, not a conflict check.
- `packages/core/src/files/ports.ts` declares the document service port.
  `apps/server/src/app.ts` supplies it. Core keeps no runtime dependency.
- `commitChangeset` checks authorization and an existing mutation receipt
  before it checks the epoch. A matching accepted retry returns its stored
  result. A mutation identity with a changed request is refused.
- The service applies each update to a trial document. It refuses malformed
  data, unresolved insertion or deletion dependencies, unsupported document
  structure, and a result past the bounds before any accepted state changes.
- Complete observed-state coverage of the document before the update decides
  the merged mark. A metadata-only head change is not an unseen text edit.
- The server derives Markdown and its digest from the result. The revision
  follows the current head. Text never rebases by whole-text replacement.
- Every accepted text writer uses this path: direct note operations, import,
  History and Trash restore, and link rewrites after a path move. A restore
  edits the current document. It does not replace its character identities.
- Document bytes, Markdown, revision updates, indexes, cursor, and receipt
  commit inside the same accept savepoint. A returned domain refusal changes
  none of them. `runTransaction` alone does not roll back a returned refusal.
- Feed records bind an update, text, digest, observed state, and epoch to one
  revision. A full snapshot binds document bytes to its captured cursor.
  An accepted receipt confirms a write, not that its caller applied the state.

This supersedes [0076](0076-the-text-of-a-note-is-a-crdt-document.md). Its
replacement of records 0024 and 0026 for text remains. Record 0026 still owns
Needs attention. Records 0022 and 0073 still own save boundaries and path intent.

## Consequences

- History and other readers keep stored Markdown. Writers share one authority.
- `tests/integration/sync.test.ts` proves deletion-only merges, restore, and
  move rewrites with offline edits. Failed changesets leave all state unchanged.
- Convergence requires the same accepted updates and document identities. It
  does not promise sentence quality or a CRDT guarantee for legacy text repair.
