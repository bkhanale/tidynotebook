# 0096. An edit keeps the structure of a table

- Status: Accepted
- Date: 2026-09-24

## Context

Record 0095 kept the pipes of a table from the edit of a person with a change
filter, and let every other character go. Backspace in a cell removed the text,
then the padding, and the cell with no width left was no longer a cell, so its
row lost a column. A deletion across cells or rows left `||` in the same way.
A filter of characters cannot promise a table. The owner also found the four
table tools of the formatting row hard to use, and asked for controls on the
table, as Obsidian has.

## Decision

- No edit of a person changes the rows or the columns of a table. An edit
  inside the text of one cell passes as it is. Any other edit that meets a
  table is expressed on its model in `packages/editor/src/table-grid.ts`: the
  text of each cell it covers changes, and the table is written again as the
  smallest character changes. This replaces the change filter and the input
  filter of record 0095.
- A change that covers a whole table removes it. The part of a change outside
  a table applies, and the line break beside the table stays.
- A **+** bar under a table adds a row at its end, and a **+** bar at its right
  edge adds a column. The editor draws them in a layer over the text while the
  pointer is over the table or the caret is in it. They replace no text, so
  record 0002 holds.
- The table tools leave the formatting row. The command palette keeps every
  table action, from one list in `apps/web/src/lib/format-toolbar.ts`, and
  shows it while the caret is in a table. This refines records 0094 and 0095.

## Consequences

- Backspace and Delete empty a cell and never remove it. Only a table action
  adds or removes a row or a column.
- `table-grid.test.ts` holds the edit rule for every case of the owner report.
