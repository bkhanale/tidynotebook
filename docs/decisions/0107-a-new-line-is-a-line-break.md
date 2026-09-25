# 0107. A new line is a line break

- Status: Accepted
- Date: 2026-09-25

## Context

Record 0068 joins two lines of one paragraph in the live preview, and record
0070 gives Shift and Enter a backslash break, so that the note surface reads a
paragraph the way CommonMark does. The owner reported two defects on
2026-09-25. A paragraph reflows each time the caret enters it and leaves it,
so a note moves while a person reads it. The join also puts a continuation
line of a list item on the row of its marker, outside the body cell that
`packages/editor/src/live-preview.ts` draws, so the text stood in a column one
character wide.

Obsidian never joins source lines in its editor, and by default its Reading
view shows a single new line as a break. Notion keeps a line break inside a
block as a line break. Both show a new line where the person wrote one.

## Decision

A single new line inside a paragraph is a line break on every surface.

- `renderMarkdown` in `packages/markdown/src/render.ts` writes a `br` element
  for each soft break. Read mode and the published page read it there.
- The live preview in `packages/editor/src/widgets.ts` keeps each source line
  on its own line and joins nothing. The marker of a hard break still hides
  while the selection is away from its paragraph.
- Shift and Enter write a new line that continues the list item or the block
  quote, with no marker. Enter keeps its list continuation.

The stored Markdown does not change, and a blank line still starts a
paragraph. This supersedes records 0068 and 0070.

## Consequences

- A paragraph does not reflow when the caret moves, and the note surface and
  the published page still agree (record 0025).
- A note that another CommonMark tool renders joins those lines. The export
  stays the same text (record 0021), so the difference is only in that tool.
- `packages/markdown/src/render.test.ts`, `packages/editor/src/widgets.test.ts`
  and `packages/editor/src/keymaps.test.ts` hold the rule.
