# 0175. A key changes only the editor

- Status: Accepted
- Date: 2026-10-02

## Context

The audit of 2026-10-02 measured two frames for a key at p95 and about 18
changes of the page outside the editor for each key (issue 262).
`tools/performance/typing.ts` found the causes. Each key wrote the document
row of the note (`mergeNoteWork`), which decodes the stored document, and
the store announced a `file` change. Every listener read again: the file
list of the area, the document of the open note with a join, its save
snapshot and checkpoints, and the link completion list. The key also copied
the whole text out of CodeMirror, set state of the note screen, and the save
facts reached a context that the whole frame reads. React writes the `name`
and `type` of every input that it renders again.

## Decision

- A key sets no React state, writes nothing to the store and announces
  nothing. The change callback of `createEditor` gives a reader of the text,
  and the note screen keeps the key in references and timers.
- `openBoundNote` holds the work of the person until `takeLocalWork`. The
  note screen writes that work and the draft in one local write, after a
  pause of `draftSaveDelayMs` and at most `localWriteMaxWaitMs` after the
  first key that it holds (`features/editor/write-schedule.ts`), and before
  every checkpoint, which waits for it (record 0133). Each write still
  merges inside one transaction (record 0085).
- `mergeNoteWork` announces the kind `document`: the document of one note
  took local work and nothing else changed. A change that the store of this
  tab announces carries `sameTab`. The open editor skips its own `document`
  changes and joins those of another tab. The file list and the loader do
  not read the kind.
- The word count, the outline and the attachment scan read the text after
  `documentWorkDelayMs` of quiet, through the scope of the open note, and
  the note screen does not render for them.
- The shell reads the save facts of the open note through a selector of one
  store, and only the facts it shows: a failed local write and the time of
  the last version.

This excludes a store write, a store notice and a render of the note screen
for each key.

## Consequences

- A crash loses at most `localWriteMaxWaitMs` of typing, as a draft did.
  Another tab sees the work after a pause, not after each key.
- `pnpm perf:typing` states the time of a key and the changes outside the
  editor. `write-schedule.test.ts`, `document-binding.test.ts`,
  `lib/fact-store.test.ts` and `tests/integration/browser-storage.test.ts`
  hold the schedule, the held work, the selector and the new kind.
