# 0095. A table is a grid over its text

- Status: Accepted
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
presents it as a grid. `packages/editor/src/table-grid.ts` holds the rule.

- A CodeMirror block wrapper puts one element around the lines of each table.
  It draws the outline and scrolls the table sideways on its own.
- The pipes and the delimiter row never show, and they are atomic ranges.
- A transaction filter holds a caret inside the text of a cell. A change
  filter keeps the pipes, the delimiter row and the line breaks of a table
  from the edit of a person, unless the edit removes the whole table. A typed
  pipe is escaped, and a pasted line break becomes a space.
- A table command reads the table into a model, changes the model, writes the
  table again as aligned GFM, and applies the difference as the smallest
  character changes, in one transaction.
- The actions on rows and columns are tools of the formatting row of
  decision 0094. They show while the caret is in a table, and the command
  palette takes them from the same list.
- No widget kind is added. This refines decision 0002: a table row keeps its
  grid under the caret instead of showing its source.

## Consequences

- Undo, IME composition, find and replace and remote work reach a cell as
  they reach a paragraph, because a cell is text of the one editor (0082).
- The published page, the export and the grammar do not change.
- `table-grid.test.ts` holds the model, the commands and the three filters.
  A drive of the note surface proves the grid, the scroll and the keys.
