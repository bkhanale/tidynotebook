# 0175. A key changes only the editor

- Status: Accepted
- Date: 2026-10-02

## Context

The [performance audit](../audits/2026-10-02/performance.md#typing) of
2026-10-02 measured a key that takes longer than one frame, and many changes of
the page outside the editor for each key (issue 262).
`tools/performance/typing.ts` found the causes. Each key merged its work into
the stored document (`mergeNoteWork`), which decodes the whole document, and
announced a `file` change. Every listener read again: the file list of the
area, the document of the open note, its save snapshot and checkpoints, and
the link completion list. The key also copied the text out of CodeMirror,
set state of the note screen, and the frame read the save facts through a
context. React writes the `name` and `type` of every input that it renders
again. A key must still reach the disk at once: a closed tab, a killed phone
browser or a crash must not lose it.

## Decision

- A key writes its work at once and cheaply. The open note appends the Yjs
  update of its keys to `documentUpdates` of `packages/storage-browser`,
  with no decode of the document, in one small write for each animation
  frame at most (`appendNoteWork`). A hidden tab runs no frame, so it and the
  end of the screen append at once. The store folds the updates into the
  document when their count or their size passes a bound, at a checkpoint
  and on every write of the document. Every read of a document returns the
  document with its updates of the same generation, and a checkpoint freezes
  both (record 0133).
- A draft follows a pause in typing. It records the state vector of the
  document that it saw, and only after the store took every change that the
  vector names, because a state vector does not count a deletion. The open
  of a note takes the text of its document when that document holds every
  change that the draft saw, so a draft that lags its document never
  becomes work (record 0133 named this case).
- A key sets no React state. The change callback of `createEditor` gives a
  reader of the text, and the note screen keeps the key in references and
  timers. A version claims only the changes whose work it wrote, so a key
  that arrives while it runs gets a version of its own.
- The write announces the kind `document`, marked with the working copy
  that wrote it. The open editor skips its own work and joins every other.
  The file list and the loader do not read the kind.
- The word count, the outline and the attachment scan read the text after a
  quiet time, through the scope of the open note. The shell reads the save
  facts of the open note through a selector, and only the facts it shows.

This excludes a merge of the stored document for each key, a store notice
that the file list reads for each key, and a render of the note screen for
each key.

## Consequences

- A key is on the disk one frame after it reaches the editor.
- Every transaction that reads or writes a document also covers its
  updates, and every removal of a document removes them.
- `pnpm perf:typing` states the time of a key and the changes outside the
  editor. `apps/web/src/features/editor/note-work.test.ts` holds the writes
  of the editor, and `tests/integration/browser-storage.test.ts` the
  appended work, its fold and the draft vector.
