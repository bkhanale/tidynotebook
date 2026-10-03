# 0186. The parse of a note grows with its size

- Status: Accepted
- Date: 2026-10-03

## Context

- Commit `34336b8` kept two limits of the grammar, the size and the nesting
  depth, because the one author was the one person who reached the parser.
  That is no longer true. A workspace has members, sign-up can be open
  (record 0114), and a note can be published (record 0030). The server parses
  a note on each commit, import, published page and search migration, and
  each device parses it to open and to search it.
- micromark matches emphasis, link and image labels, inline HTML and inline
  math inside one inline block: a paragraph, a heading or a table cell. Its
  work grows with the square of the marks of that block. The table extension
  keeps one list of edits for the whole document, so its work grows with the
  square of all the table cells. A short note held a server worker for
  seconds (the audit of 2026-10-02).
- The Lezer grammar of the editor ran out of stack on a deep run of inline
  marks.

## Decision

- `packages/markdown/src/limits.ts` adds two limits: `maxBlockMarks`, the
  marks of one inline block, and `maxTableCells`, the table cells of one
  note. A mark is a character that can open or close an inline construct:
  `*`, `_`, `~`, `[`, `]`, `$`, `<`, `\(` and `\)`. The work of a parse then
  grows with the size of the note.
- `assertParseLimits` reads each line once, before the parse. It counts the
  marks of each part of the note between two blank lines. From the line above
  a table delimiter row to the next blank line, it counts one cell for each
  pipe and one for each line. A part holds every inline block in it, so a
  part within the mark limit holds no block above it.
- Only when a part holds more marks than the limit, a parse with every inline
  construct disabled gives the paragraphs, headings and table cells of the
  one grammar, and each is held to the limit. That parse is linear. No second
  scanner decides where a block ends.
- `parseMarkdown` and `withinParseLimits` run both checks, so every reader of
  a note agrees: the renderer, the plain text, the links, the commit, the
  import, the published page, the migrations, local search and the editor.
- A refusal is `MarkdownLimitError` with `block-marks` or `table-cells`, the
  domain codes `note_too_many_marks` and `note_too_many_cells`, and the 422
  `unrenderable_note` with one message for each cause.
- The editor keeps its Markdown language only for a note within
  `withinParseLimits`. It shows another note as plain text, as a reader shows
  the source of a refused note.
- A limit is a count, so a note passes or fails the same way on each machine.
  This excludes a timeout, a cost score, a limit for each construct and a
  patch of an upstream package.

## Consequences

- A note that an earlier release stored can be over a limit. It opens as
  plain text, and a save of it is refused with the message until the author
  divides the paragraph or the table. The data migrations and the link
  rewrite of a move keep such a note as it is (`docs/development/database-operations.md`).
- A note whose parts are within the mark limit costs no second parse.
- `packages/markdown/src/limits.test.ts` holds each limit at its bound and one
  above, and holds that the count of a part is never below the count of a
  block in it. `tests/integration/revisions.test.ts` holds the 422 of a
  commit, and the editor tests hold the plain text of a refused note.
