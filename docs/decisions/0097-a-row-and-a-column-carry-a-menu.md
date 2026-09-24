# 0097. A row and a column carry a menu, and a paste fills cells

- Status: Accepted
- Date: 2026-09-24

## Context

Record 0096 left the removal of a row and a column to the command palette, and
the owner could not find it. A row copied from a table reached a cell as its
Markdown source, because a pasted pipe was escaped into the one cell, where a
person expects the cells of the row.

## Decision

- A handle stands at the start of the active row and above the active column
  of a table: the one under the pointer, or the one of the caret. It opens the
  menu of that row or that column: insert above and below, insert left and
  right, align left, center and right, and delete. The header row takes no row
  above it and is never deleted, and the last column stays.
- The editor draws the handle in the layer of the add bars of record 0096 and
  asks the application for the menu through `tableMenuOpener`. The menu is
  `AnchoredMenu` of `packages/ui`, which shares the list, the keys and the
  placement of `Menu`. An action runs on the cell of its handle.
- The command palette offers the same actions from the same list,
  `apps/web/src/lib/table-menu.ts`, while the caret is in a table.
- Text pasted into a cell that holds a tab or a pipe with no backslash is a
  range of cells. It fills the cells from the cell of the caret to the right
  and down, and the table grows by the rows and the columns it needs. Plain
  text with line breaks stays in the one cell.
- Every control of a table takes the look of the table: the divider edge and
  square corners.

## Consequences

- A person deletes a row or a column where it stands, with a pointer or a
  finger, and from the command palette with the keyboard.
- A row copied from a table or a range copied from a spreadsheet pastes into
  its cells.
- `table-grid.test.ts`, `keymaps.test.ts` and `table-menu.test.ts` hold the
  rules. It refines record 0096.
