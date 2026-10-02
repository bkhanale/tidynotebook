# 0163. A new note takes its name from its first heading

- Status: Accepted
- Date: 2026-10-02

## Context

A new note is named New note, New note 2 and so on by `freeNotePath` in
`apps/web/src/lib/new-note-draft.ts`, and the name stays when the first line
is a heading (issue 252). See
[design 023](../design/023-names-the-tree-and-long-lists.md).

## Decision

- The name of a note follows its first line when that line is a heading, read
  by `previewStructureOf` of `packages/editor` from the first block of the
  text. A note that starts with any other block keeps its name.
- The rule applies while the name is automatic: New note or New note with a
  number, or the name that the heading gave, with or without the number that
  kept it free. Any other name is the choice of a person and stops the rule.
  No flag is stored: the name carries the fact. A daily note (record 0099) is
  never renamed. Until the daily note settings answer, as on a fresh device
  with no connection, the default layout of `packages/core` guards it.
- The open editor applies the rule at the boundary of a version (record 0022)
  in `checkpointNow` of `apps/web/src/features/editor/note-editor.tsx`, so one
  version holds the new heading and the new name, and only after input since
  the last version, so a note that only opens writes nothing (record 0133). It
  waits while the name field holds words that a person is typing.
- The name is the first free one in the folder, with a number after it as New
  note takes. It holds no slash, no backslash and no control character, and
  it is at most 60 characters, cut at a word.
- A new note opens with the caret in its text, where the first heading names
  it. The name field stays one click away.
- `apps/web/src/lib/note-auto-name.ts` holds the rule as pure functions.
- A rename is a path change, so the server rewrites every portable link to the
  note when it accepts the version (records 0037 and 0081). Nothing new
  rewrites a link.

This excludes a stored mark of a name a person chose, a rename on each
keystroke, and a name from a paragraph.

## Consequences

- The tree, All notes and the palette read the heading of a new note after
  its first pause.
- A note whose name a person typed and that equals its heading follows the
  heading. A rename to other words ends that.
- A rename made with no connection waits in the queue, and its links are
  rewritten when the server accepts it.
- `apps/web/src/lib/note-auto-name.test.ts` holds the rule and each refusal.
