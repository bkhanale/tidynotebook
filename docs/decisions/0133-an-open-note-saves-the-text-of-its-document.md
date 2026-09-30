# 0133. An open note saves the text of its document

- Status: Accepted
- Date: 2026-09-30

## Context

Record 0085 makes the open editor write each change into the document at
once, but `checkpoint` in `packages/storage-browser/src/local-store/` still
diffed the draft text into it. That text can lag remote work that the store
took first, so the diff wrote a revert or a second copy of that work as work
of this device, and a task box read `[  ]` or `[xx]`. The note loader read
the text and the document in two reads, with the same effect.

## Decision

- `checkpoint` takes a `CheckpointSource`. With `document`, the checkpoint
  writes no text into the document. It freezes the stored document, and the
  text of the version is the text of that document. The draft gives the path,
  the parent, the deletion state and the sequence.
- The open editor checkpoints with `document`, and waits for its local
  writes first. A writer with no open document, such as a new note or a text
  that a person places, checkpoints with `text` and keeps the diff.
- An editor with no input since its last checkpoint writes no version. The
  work of another tab or device in its document is a version of the editor
  that wrote it.
- `readCachedNote` returns the document of the note from the same read as its
  text, and the note loader opens the editor from that pair.

This refines record 0085. Every other part of that record stands.

## Consequences

- A save of an open note never holds text that its document does not hold.
- `tests/integration/sync.test.ts` and
  `tests/integration/browser-storage.test.ts` prove the lagging editor, the
  frozen document and the paired read.
- A kept draft older than its document still becomes work when the note
  opens, until a draft records the state that it saw.
