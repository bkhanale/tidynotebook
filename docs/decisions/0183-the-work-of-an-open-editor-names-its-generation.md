# 0183. The work of an open editor names its generation

- Status: Accepted
- Date: 2026-10-03

## Context

Record 0175 appends the work of each frame to `documentUpdates`, and every
read and write of the document folds that work in. A review of the save path
found three ways to store work that the document cannot take. An append took
the generation of the stored row, not of the editor, so a key typed after a
new generation arrived (record 0179 keeps that editor) named items of the old
one. An append that failed did not stop the appends that built on it. A
snapshot replaced the row under work of the open editor. The fold then threw
`corrupt` on every read and write of the note: the note did not open, and each
feed page that named it failed, so the sync of the workspace stopped.

## Decision

- Each write of open editor work names the generation of its document:
  `appendNoteWork`, `mergeNoteWork`, and a `checkpoint` from the document.
  The store refuses work of another generation as `stale`, so work of one
  generation never enters another (record 0084). The editor takes its
  generation from the read that the loader opened it from. A note that the
  device starts is generation 1.
- The appends of an editor run one at a time, in order. After a failed append
  no later append runs. The work waits in the editor, and the next version
  writes the whole document first. The draft states no vector meanwhile, so
  its text is the recovery copy.
- The editor knows the changes that the store took. A read of the stored
  document that lacks one of them, or that holds a new generation under keys
  of the editor, marks the work as not written, with the same result.
- A fold applies every pending update that applies and leaves out an update
  that cannot. A read never fails on such an update, and the next write of
  the row removes it. A row that an earlier release made unreadable heals
  this way.

This refines records 0175 and 0179. It excludes a stored update that names
another generation and a fold that refuses the whole row for one update.

## Consequences

- No pending update makes a note unreadable or stops the sync.
- A new generation under typed keys saves nothing until the next open of the
  note, which takes the text of the draft.
- `note-work.test.ts` holds the order and the repair of the appends,
  `head-replaced.test.ts` the generation of the editor, and
  `tests/integration/browser-storage.test.ts` the refusals and the fold.
