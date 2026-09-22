# 0076. The text of a note is a CRDT document inside its revisions

- Status: Superseded by [0081](0081-accepted-text-and-observed-state-belong-to-one-document.md)
- Date: 2026-09-21

## Context

`rebaseHeads` in `packages/core/src/files/commit.ts` puts a save over an older
head on top of the current head, and the text of the other device leaves the
note for History (records 0024 and 0026). The engine in
`packages/sync/src/engine.ts` sends before it reads, so a device that saved
offline cannot compare texts in time. Issue 152 and
[design 013](../design/013-conflict-free-sync-of-note-text.md) ask that two
devices always reach one note that holds the work of both.

## Decision

- The text of a note is a CRDT document (record 0077 names the library).
- A revision of a note carries an update with every local operation since the
  last head its device applied, and the state vector its device held. It
  carries no text and no digest. The contract carries the bytes as base64.
- The server keeps one current document for each note. Inside the transaction
  of `commitChangeset` it applies the update, reads the text, checks it,
  computes the digest and stores the text as the content of the revision. The
  server is the one writer of the Markdown of a note.
- The parent of a note revision is always the current head, so History stays
  one line. A revision records that it merged when the state vector of its
  device does not cover the current document.
- The server keeps the update of each revision for the change feed. A feed item
  carries the update, the text and the epoch (record 0080).
- A save never rebases text and never supersedes a head. The precondition of
  record 0073 applies to the path and the deletion state only.
- The device stores the last head it applied, with its revision, text and
  state vector, because a document cannot give back an earlier text. A save
  queues the update since that head, so every queued mutation stands alone,
  and it keeps the text of the document at that save for local History and
  for Review (record 0079). The open editor holds one document joined to
  the one CodeMirror view, applies remote updates with a remote origin, holds
  them during a composition, and undoes local edits only.
- When the device holds no unsent work and its feed reached the head, the
  digest of its text must equal the digest of the head. A mismatch takes the
  document of the server and replays local work (record 0080).

This supersedes records 0024 and 0026 for text. Record 0026 stays for Needs
attention, which keeps a save that the server refuses for good. It refines
records 0022 and 0073. It excludes a three-way merge of whole texts, a merge on
the device before it sends, and a held save.

## Consequences

- Two devices reach one text in every order of arrival, online or offline.
- History, search, backlinks, export, import and the published page read stored
  Markdown and do not change.
- The gate proves two devices on a real server in
  `tests/integration/sync.test.ts`, and the device rows in
  `tests/integration/browser-storage.test.ts`.
