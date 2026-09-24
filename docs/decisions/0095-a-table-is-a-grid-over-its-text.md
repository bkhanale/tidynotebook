# 0095. A table is a grid over its text

- Status: Proposed
- Date: 2026-09-24

## Context

A person who edits a table meets its source: the caret lands among the
padding spaces and after the last pipe, Tab leaves the editor, no action adds
a column, and a wide table scrolls the whole note. Decision 0002 keeps a table
as text and shows the source of the row under the caret. The owner asks for a
table that a person fills like a spreadsheet, with no pipe or dash on the
screen, and that scrolls inside itself.
See [design 014](../design/014-a-table-is-a-grid.md).

## Decision

A table stays Markdown text in the one editor of the note, and the editor
presents it as a grid.

- A CodeMirror block wrapper puts one element around the lines of each table.
  It draws the outline and scrolls the table sideways on its own.
- The pipes and the delimiter row never show. They keep their boxes and are
  atomic ranges, so the columns never move and the caret steps over them.
- A transaction filter holds the caret inside the text of a cell.
- Table commands in `packages/editor` move between cells, add and remove a
  row and a column, and write the padding of the rows again after each edit,
  in the same transaction, so the source stays aligned GFM.
- The actions on rows and columns are tools of the formatting row of
  decision 0094, and so rows of the command palette.
- No widget kind is added. This refines decision 0002: a table row keeps its
  grid under the caret instead of showing its source.

## Consequences

- Undo, IME composition, find and replace and remote work reach a cell as
  they reach a paragraph, because a cell is text of the one editor (0082).
- The published page, the export and the grammar do not change.
- `@codemirror/view` must keep block wrappers and their composition fixes;
  the pinned version holds both.
- Unit tests of the table commands and of the caret filter hold the rules. A
  drive of the note surface proves the grid, the scroll and the keys.
