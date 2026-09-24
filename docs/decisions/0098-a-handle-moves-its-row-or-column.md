# 0098. A handle stands outside the table and moves its row or column

- Status: Accepted
- Date: 2026-09-24

## Context

The owner tried the handles of record 0097. The row handle stood over the
first cell and covered its text. On a phone the table started at the edge of
the scroller, so the handle was cut and only half of it showed. With a handle
on every row and every column, the add bars of record 0096 are one more
control that the menu already covers. The owner asks that a handle also drag
its row or its column to a new place.

## Decision

- The add bars leave the table. The menu of a handle and the command palette
  insert a row and a column, and Tab in the last cell and Enter in the last row
  still add a row.
- The row handle stands to the left of the table and the column handle stands
  above it, fully outside the cells. The outline of each table keeps a margin
  at its start and above it that holds the handles, and the margin is larger
  on a coarse pointer, as the handles are.
- A press on a handle that does not move opens the menu of record 0097. A
  press that moves drags the row or the column. A line shows where it lands,
  and the release moves it there through one edit of the table model, so one
  undo puts it back. The header row does not move and no row moves above it.
- The menu and the palette take four more actions from the same list: move row
  up, move row down, move column left, move column right. An action is absent
  where it cannot move.
- Each hidden separator of a row is a cell of no width, so a row holds only
  cells. A loose node between two cells became an anonymous cell of the
  browser, and after a move some rows split those cells and stopped lining
  up.
- The room above a table is a padding of its wrapper and not a margin. The
  editor measures the padding of a wrapper into the height of its lines and
  never its margin, so a margin put each row lower than the editor knew, and
  a click or Home found the wrong row.
- A table that has a blank line under it keeps one after every edit. GFM reads
  a line of text right under a table as one more row, so a Backspace at the
  start of that text, or text written on the blank line, added a row.

## Consequences

- No control covers the text of a cell, and a phone shows each handle in full.
- A person reorders the table with a pointer, a finger, the menu, or the
  keyboard through the palette.
- `table-grid.test.ts`, `keymaps.test.ts` and `table-menu.test.ts` hold the
  rules. It refines records 0096 and 0097.
