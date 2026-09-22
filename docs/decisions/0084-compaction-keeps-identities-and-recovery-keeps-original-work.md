# 0084. Compaction keeps identities and recovery keeps original work

- Status: Accepted
- Date: 2026-09-22

## Context

Record 0080 discards character identities during compaction. Three text values
cannot resolve every repeated passage or lost reply. Legacy work still needs
a safe migration. See [design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- The server initializes each existing note once in a restartable migration
  beside `packages/storage-server/src/portable-markdown-migration.ts`. A trashed
  note starts from the last live text needed for Restore. An empty tombstone
  must not erase that state. A new offline note starts on its creating device.
- An import starts on the server. No device initializes an existing note from
  Markdown. A purged identity stays gone; recovery uses a new note identity.
- Routine compaction merges stored updates and uses supported garbage
  collection. It preserves character identities and the epoch. A snapshot and
  feed retention rule must still accept offline updates from before compaction.
- An epoch identifies one document generation. Initial migration or an explicit
  repair can establish it. No automatic destructive reset ships in this change.
  A future reset needs a separate decision and protocol before implementation.
- A real epoch boundary emits a full document. Snapshots contain a full
  document at their cursor. An old-epoch save is refused after receipt lookup.
- Before transforming uncertain work, the device resolves its original
  mutation identity and request digest. Accepted work is not replayed. New
  requests and recovery notes get stable identities in a durable migration map.
- `packages/note-document` owns bounded legacy text recovery. It preserves
  original checkpoints and their order, line endings, and Unicode. It reports
  ambiguity instead of claiming a lossless CRDT merge from text alone.
- Work that cannot be placed safely becomes a normal synced recovery note and
  reaches Review. Migration progress and replacement identities commit together.
  Original work stays until its replacement is durable. A retry creates no copy.
- A size limit never starts a new generation silently. If ordinary compaction
  cannot meet a limit, preserve the work and offer bounded text recovery to a
  new note, or an export when it cannot sync. A refused oversized delta does
  not block unrelated saves or repeat forever without a recovery action.
- Same-epoch repair first preserves local work, then takes the complete server
  document. Apply compatible pending updates; use bounded recovery only when
  their identities or dependencies cannot be trusted. Equal text alone does
  not prove equal document state.

This supersedes [0080](0080-a-document-starts-once.md). Record 0086 owns the
client upgrade and deployment sequence.

## Consequences

- Routine compaction keeps offline merging. It cannot promise constant storage.
- Seeded tests prove old updates survive compaction. Integration tests prove
  restartable migration, lost-reply reconciliation, stable recovery identities,
  pending new notes, and refusal without partial writes. Measurements and
  resource bounds belong to the implementation and its issue evidence.
