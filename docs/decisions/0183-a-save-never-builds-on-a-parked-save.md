# 0183. A save never builds on a parked save

- Status: Accepted
- Date: 2026-10-03

## Context

- A save that the server refuses for good is parked: its queue entry keeps the
  state `conflict` and its text waits in Needs attention (records 0087, 0088).
  Its checkpoint stays the last checkpoint of the working copy.
- The next checkpoint named it as its parent (`local-store/versions.ts`). The
  server holds no such revision, refuses with `invalid_graph`, and each later
  save of the note was parked the same way. A person who reads "Divide the
  paragraph." edits the note, and no edit reaches the server. Retry, Save as
  new note and Discard left the working copy on a removed checkpoint.
- A save carries the work of the device since the state that the server has
  (record 0085), so a later save already carries the parked work.

## Options

1. Refuse edits while a save of the note is parked. The person cannot do what
   the sentence asks, and the words wait in a draft, which is no version (0022).
2. Join the parked text into the next save. The joined save holds the refused
   text, so it is refused again, and a text join is a second merge path (0081).
3. Send the next save on the last accepted head and keep the parked save for
   review. Needs attention lists text that the note already holds, and its
   Retry writes the refused text over the later edit.
4. As 3, and a later save that carries all the work of a parked save
   supersedes it. The refused text, never a server version, leaves the local
   history of the device.

## Decision

Option 4.

- The parent of a new checkpoint is the nearest revision of its chain whose
  save is not parked (`parentOfNextSave`, `local-store/shared.ts`), and the
  expected head follows from it (0073). The text compare still reads the last
  checkpoint, so unchanged text makes no save.
- `markConflict` moves each unsent save that names the parked save as a parent
  to its parent, in the same transaction. A frozen body is not changed.
- `supersededSaves` (`packages/sync/src/parked.ts`) decides: a later save
  supersedes a parked save when each revision of the parked save is a live
  document save of the same note and generation whose insertions and deletions
  the later save observed (`observedCovers`, `@notesapp/note-document`).
- `acknowledge` removes each parked save that the accepted save supersedes,
  with its checkpoints and kept text, in the transaction of the answer.
  `markConflict` removes each earlier parked save that the new one supersedes,
  so Needs attention shows the newest refused text of a note once.
- Any other parked save stays for review with its sentence.
- A removed checkpoint moves each draft that names it to its first kept
  ancestor.

This refines records 0022, 0073, 0087 and 0181.

## Consequences

- The edit that a refusal asks for saves and ends the row of the refusal. Every
  word stays: the accepted save holds it, or the kept text still waits.
- `parked.test.ts` and `observed.test.ts` hold the rule.
  `tests/integration/browser-storage.test.ts` holds the parent, the move and
  the removal. `tests/integration/sync.test.ts` holds a refused new note and a
  refused existing note that a later edit saves against a real server.
