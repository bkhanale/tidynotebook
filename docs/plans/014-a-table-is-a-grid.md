# Plan 014: A table is a grid

Status: complete

> No issue holds this work yet. The owner keeps the
> [GitHub project board](https://github.com/users/bkhanale/projects/2) as the
> one list, and asked for the work in the branch of issue 153.

This plan turns [design 014](../design/014-a-table-is-a-grid.md) and decision
record 0095 into ordered work.

## Decisions

- [0095. A table is a grid over its text](../decisions/0095-a-table-is-a-grid-over-its-text.md)
- Refined: [0002. Widgets only where text cannot express the result](../decisions/0002-widgets-only-where-text-cannot-express.md)
- Kept: [0082. Yjs has a byte API and a private editor bridge](../decisions/0082-yjs-has-a-byte-api-and-a-private-editor-bridge.md)
- Kept: [0094. The note has one row of formatting tools](../decisions/0094-the-note-has-one-row-of-formatting-tools.md)

## Items

1. Add `packages/editor/src/table-grid.ts` with the model of a table read
   from the Lezer tree, the aligned GFM writer, and the change of one table as
   the smallest character changes. `tableSpec` in `keymaps.ts` uses the
   writer.
2. Add the table commands: next, previous, below and above cell, add and
   remove a row and a column. Bind Tab, Shift and Tab, Enter, and Shift and
   Enter inside a table, before the list bindings.
3. Add the caret filter, the change filter and the insert filter, and the
   atomic ranges of the pipes and the delimiter row.
4. Draw the grid: the block wrapper that scrolls a table, hidden pipes and
   delimiter row, cell outlines, and the mark of the active cell, in
   `live-preview.ts` and `editor-theme.ts`.
5. Add the four row and column actions to `formatActions`, a format context
   that states whether the caret is in a table, and the table tools of
   `apps/web/src/lib/format-toolbar.ts`, with their palette rows.
6. Update `packages/editor/AGENTS.md`, `docs/guide/markdown.md` and the
   shortcut table. Drive the note surface at a desktop and a phone width, in
   light and in dark, and run `pnpm verify`.
