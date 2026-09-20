# 0070. Shift and Enter writes a hard break

- Status: Accepted
- Date: 2026-09-20

## Context

Record 0068 joins a soft line break, so a new line inside a paragraph reads as
one paragraph. The owner then had no way to break a line: Enter joins, and a
blank line starts a new paragraph with the gap of a paragraph. CommonMark has
the break, and `packages/markdown` renders it, but no key wrote one and
`packages/editor/src/keymaps.ts` bound none. The marker also stayed on screen
at every selection, so the note surface showed a backslash where the published
page showed nothing, which is the disagreement record 0068 removed for the
soft break.

## Decision

Shift and Enter write a hard break. The command is `insertHardBreak` in
`packages/editor/src/keymaps.ts`. It writes a backslash, the new line, and the
continuation of the list item or the block quote the cursor sits in. Inside a
fenced code block it declines, so the plain new line applies. The marker is a
backslash and never two spaces, because a trailing space is invisible and a
trim removes it.

The marker hides while the selection is away from its paragraph, and it comes
back with the source lines of that paragraph. The ranges come from the same
paragraph walk as the join, in `packages/editor/src/widgets.ts`, so one rule
answers when a paragraph shows its source.

## Consequences

- The note surface and the published page read a broken line the same way,
  which record 0068 asks for and record 0025 requires.
- The shortcut list gains one row, so the shortcuts dialog states the key.
- Shift and Enter no longer give a plain new line.
- `packages/editor/src/keymaps.test.ts` holds the command and
  `packages/editor/src/widgets.test.ts` holds the reveal.
