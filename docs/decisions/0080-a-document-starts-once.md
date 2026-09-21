# 0080. A document starts once and an epoch carries work across a new start

- Status: Proposed
- Date: 2026-09-21

## Context

Two devices that each start a CRDT document from the same Markdown make two
sets of character identities, and their merge holds the text twice. Every
existing note, every import and every draft from before record 0076 needs a
document. A document also grows with its deleted characters. See
[design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- The server starts the document of every existing note from its head, once,
  in a data migration beside
  `packages/storage-server/src/portable-markdown-migration.ts`. An import and a
  restore of a purged note start their documents on the server. A new note
  starts on the device that creates it. No device starts a document for a note
  that exists.
- Each document has an epoch. The migration and a compaction start a new epoch.
  A compaction starts a new document from the current text when a bound of
  `packages/note-document` is passed.
- A save for an older epoch is refused. A feed item of a newer epoch carries
  the whole document.
- The device then replays its unsent work. Replay in `packages/note-document`
  compares the last text of the old epoch that the device saw, its own text and
  the new text. It keeps every local insertion at the matching place and
  applies a local deletion only to text that is still there unchanged.
- A server that meets a changeset in the old form refuses it with one code. The
  client loads the new version, its store upgrades, and its drafts and queued
  versions replay once.

This excludes a document started from Markdown on a device for an existing
note, and a compaction that drops unsent work.

## Consequences

- Replay is the only code that compares texts, and it drops no text.
- The replay rule has a unit test for each case. The migration, the epoch
  refusal and the draft upgrade are proved in `tests/integration/`.
