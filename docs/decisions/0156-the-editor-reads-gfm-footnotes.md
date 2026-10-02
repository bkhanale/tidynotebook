# 0156. The editor reads GFM footnotes

- Status: Accepted
- Date: 2026-10-02

## Context

`packages/markdown` renders GFM footnotes through `remark-gfm`, so the
published page shows a raised number and a list of notes at the end. The
editor grammar of `packages/editor/src/language.ts` has no footnote: a
reference stayed `[^n]` text and a definition parsed as a link reference
(issue 239, audit finding 4). Record 0001 requires one meaning on both
surfaces, and the equivalence test left footnotes out.

## Decision

- `packages/editor/src/footnote-syntax.ts` adds two nodes to the Lezer
  grammar. `FootnoteDefinition` is a container block: a line that starts
  with `[^label]:` under four columns of indentation, continued by blank
  lines, lines indented four columns and the lazy lines of its paragraph.
  It ends a paragraph above it. `FootnoteReference` is the inline
  `[^label]`.
- The label rule is the rule of `micromark-extension-gfm-footnote`: up to
  999 characters, no space, no line break and no `[`, a backslash escapes a
  bracket, and the match ignores case. `packages/markdown/src/footnote-syntax.ts`
  holds it, and its test compares it with `parseMarkdown`.
- A reference is a footnote only when the note defines its label, as GFM
  reads it. Any other `[^label]` stays the text it is.
- The live preview draws a reference as its label in a raised mark in the
  link colour, because the published page makes it a link, with its
  brackets hidden. A definition draws the same mark in place of `[^label]:`,
  and its lines take the footnote text of the theme. Both follow the reveal
  rule of record 0025.
- The editor shows the label and not the number of the published page. A
  number needs a walk of every reference of the note on each key press, and
  the label is what the person wrote.
- The equivalence test reads a reference in place, and a definition with
  its own structure by label, because the renderer moves the definitions to
  the end of the page.

## Consequences

- A footnote has one meaning on both surfaces, and the corpus holds a
  reference, a definition with two paragraphs and a label in two cases.
- `[^x](url)` with no definition of `x` is a link in remark and text in the
  editor. The grammar cannot see a definition while it parses one line.
- The note of block syntax holds definitions in a quote, in a list and at
  the end of the note, so record 0155 covers the new container.
