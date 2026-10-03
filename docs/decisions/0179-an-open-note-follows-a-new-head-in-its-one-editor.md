# 0179. An open note follows a new head in its one editor

- Status: Accepted
- Date: 2026-10-03

## Context

Record 0073 drops a working copy that holds no unsent work when the head of
its file moves. The note screen then read the note again and mounted a new
editor (`noteHeadWasReplaced` in `apps/web/src/features/editor/head-replaced.ts`),
because a plain text buffer held the text that the new version replaced. A
person who read the note on a second device lost the caret and the scroll on
a save of the first device, and the rule of one editor for one open working
copy broke. Since records 0081 and 0082 the open editor is bound to the
document of the note, and every change of the store joins the stored
document into it, so the buffer is never the replaced text. A restore from
History or from Trash is document work of the same generation (record 0081),
so it joins the same way. Only a new generation of a document, which record
0084 makes on compaction, cannot join: its identities say nothing about the
old ones.

## Decision

- The open note keeps its one editor when another device, a restore or a
  snapshot moves the head. The join of the stored document brings the new
  text, and the editor takes the new head as the base of its next save when
  it holds no work of its own: no key of this session, no working copy, no
  queued save, and a local head that is the accepted head
  (`headToAdopt` in `head-replaced.ts`).
- Work of another device writes no draft. A draft is recovery data of local
  work, so the editor writes one for a remote change only when it already has
  one, which keeps that draft from lagging its document.
- The editor reads the note again, with a new editor, only when the stored
  document has a new generation, and only while it holds no key of this
  session. A join of another generation is never applied.
- A note that comes back from Trash while the screen shows its deleted state
  still reads the note again, because no editor is open then.

This refines record 0073: its precondition and its dropped working copy stand.

## Consequences

- A second device keeps its caret, its selection, its undo and its scroll on
  every save of another device.
- `head-replaced.test.ts` holds the rule, `document-binding.test.ts` the join
  of a remote save and of a restore, and `pnpm perf:save` drives two devices.
