# 0104. A new note is a version when it is made

- Status: Accepted
- Date: 2026-09-25

## Context

Record 0022 makes a version on a pause in typing, on leaving the note, on a
hidden tab, and on Ctrl + S. A new note, a copy from Duplicate, and a daily
note (record 0099) start as a local draft only. They reach the server only
after an edit or a boundary of the editor, so a person who makes a note and
stays on it sees it as a note of this device alone. The text of a copy and of
a daily note is already a complete note when it is made. A second device does
not see it, and a tab that closes before the flush keeps it only as a draft.

## Decision

- To make a note is a natural boundary. `createNote` in
  `packages/sync/src/create-note.ts` writes the first draft and its checkpoint,
  and every surface that makes a note calls it: New note, Duplicate, a daily
  note, and a recovered note of the sync queue.
- The checkpoint queues the create, and the queue change wakes the sync
  engine, so the note goes to the server at once when there is a connection.
  With no connection it waits in the queue, as every save does.
- An empty new note is sent as well. One rule holds for every way to make a
  note, and an empty note is a note that a person can see in the tree.
- No surface writes the first draft of a note alone.

## Consequences

- A note that a person makes is on the server and in History from the start.
- A new note that a person leaves empty stays on the server until they move it
  to Trash.
- `packages/sync/src/create-note.test.ts` holds the rule, and
  `tests/integration/sync.test.ts` proves that the note reaches the server
  with no edit.
