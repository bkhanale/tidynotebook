# 0133. An open note saves the text of its document

- Status: Accepted
- Date: 2026-09-30

## Context

Record 0085 makes the open editor write each change into the document of the
note at once. `checkpoint` in `packages/storage-browser/src/local-store/`
still diffed the text of the draft into that document. The text of an open
editor can lag its document: remote work reaches the store before the editor
joins it. The diff then wrote a revert of that work, or a second copy of it,
as new work of this device. With two devices open, a task box that one device
toggles fast became `[  ]`, `[xx]` or two boxes. The note loader also read the
text and the document of a note in two transactions, so work that landed
between the two reads gave the same diff.

## Decision

- `checkpoint` takes a `CheckpointSource`. With `document`, the checkpoint
  writes no text into the document. It freezes the stored document, and the
  text of the version is the text of that document. The draft gives the path,
  the parent, the deletion state and the sequence.
- The open editor checkpoints with `document`, and waits for its local
  writes first. A writer with no open document, such as a new note or a text
  that a person places, checkpoints with `text` and keeps the diff.
- `readCachedNote` returns the document of the note from the same read as its
  text, and the note loader opens the editor from that pair.

This refines record 0085. Every other part of that record stands.

## Consequences

- A save of an open note can hold remote work that the screen shows a moment
  later. It never holds text that the document does not hold.
- `tests/integration/sync.test.ts` proves that a device whose editor lags
  never adds a task box, and `tests/integration/browser-storage.test.ts`
  proves the frozen document and the paired read.
- A kept draft that is older than its document still becomes work when the
  note opens. Only a record of the state each draft saw can tell that draft
  from unsent text.
