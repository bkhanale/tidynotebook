# 0083. Metadata conflicts preserve unseen text work

- Status: Accepted
- Date: 2026-09-22

## Context

Record 0078 misses deletion-only edits when it compares vectors. A duplicate
save can also restore a note without new work. Path reuse and a purge feed
need recovery rules as well as a refused push. See
[design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- `packages/core/src/files/commit.ts` owns the metadata rules. An unchanged
  path keeps the accepted path. Actual path intent uses the base of record 0073. The last accepted rename of one note wins and remains in History.
- A rename or folder move into another live file is refused atomically. It
  never overwrites that file. A create or recovery takes the next free name
  through one naming rule shared by core and the client.
- An edit wins over concurrent Trash in either arrival order. Trash carries
  complete observed state as record 0081 defines it. Unseen insertion or
  deletion state prevents Trash. The tombstone retains the document behind it.
- New text work against that tombstone applies and restores the note. Work
  already included when Trash was accepted does not restore it. A duplicate
  update or a metadata-only save cannot pass as new text work.
- A folder move and text work inside it both apply. Link rewrites are document
  edits in the same acceptance transaction under record 0081.
- Permanent deletion ends the old file identity. Local unsent work becomes
  one normal synced note with a new stable identity and a free path. This rule
  applies to a refused push, a purge feed item, and confirmed snapshot absence.
  Preserve a draft before removal; absence is not inferred from a partial page.
- Recovery is durable and idempotent. One refused batch cannot discard work
  on its other files. The affected device reads one notice with a useful action.

This supersedes [0078](0078-one-rule-for-each-conflict-that-is-not-text.md)
and replaces record 0026's recovered copy for concurrent Trash with the note
itself. Permanent deletion and ambiguous legacy recovery use new identities.

## Consequences

- `tests/integration/sync.test.ts` proves deletion-only edits against Trash
  in both orders, duplicate saves after Trash, path reuse, and move rewrites.
- Browser storage tests prove purge recovery for a draft with no queued save,
  a repeated purge, snapshot fallback, and a batch with unrelated work.
