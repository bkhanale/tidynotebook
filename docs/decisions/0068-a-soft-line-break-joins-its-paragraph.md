# 0068. A soft line break joins its paragraph in the preview

- Status: Accepted
- Date: 2026-09-18

## Context

CommonMark joins two lines of one paragraph with a space, and
`renderMarkdown` in `packages/markdown` does exactly that, which
`packages/markdown/src/corpus.test.ts` proves. The live preview of
`packages/editor` left each source line on its own screen line, because a
CodeMirror line is a block element. One note therefore read as two different
documents, and the owner reported it on 2026-09-18. Record 0025 makes the
live preview the one note surface, so the two cannot disagree.

## Decision

The live preview hides the line break between two lines of one paragraph, so
the paragraph reads as one run of text. The ranges come from the syntax tree
in `packages/editor/src/widgets.ts`, beside the setext underline, because a
decoration that replaces a line break must come from a state field.

A paragraph shows its source lines again while the selection touches it, so
every character stays reachable and editable. This is the reveal rule of the
live preview and not a new exception to it.

A hard break, which is two spaces or a backslash at the end of a line, keeps
its line break. Only a soft break joins.

## Consequences

- The note surface and the published page now read one paragraph the same
  way, which the equivalence gate in
  `tests/integration/markdown-equivalence.test.ts` already holds for
  structure.
- A paragraph reflows when the caret enters it and when it leaves it. That is
  the cost of the one surface, and it is the same movement a heading, a list
  marker and a link already make.
- `packages/editor/src/widgets.test.ts` holds the ranges and the reveal.
