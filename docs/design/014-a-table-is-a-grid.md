# 014: A table is a grid

Status: complete

This design states how a person edits a table in a note without the Markdown
source of the table. It follows the formatting toolbar of
[issue 153](https://github.com/bkhanale/notesapp/issues/153), which gave the
note a Table tool, and the owner report that editing the table it inserts
behaves strangely.

## The problem

The owner asks for a table that a person fills like a spreadsheet: fixed
outlines, one cell after another, and no pipe or dash of the source on the
screen. A wide table must scroll inside itself and not move the whole note.
A person must add a row and a column without writing Markdown.

A drive of the note surface on 2026-09-24, on the build that landed the
toolbar, shows what a person meets today.

- Arrow Down from the header row skips the hidden delimiter row and puts the
  caret after the last pipe of the body row. Text typed there lands outside
  every cell, so a third cell appears beside the table.
- A click into an empty cell puts the caret among the spaces that pad the
  source, so the text of the cell starts in the middle of the padding.
- Tab leaves the editor, because the formatting keys leave Tab free outside
  a list. It does not move to the next cell.
- Enter at the end of a row starts a line that joins the table as a broken
  row until the person types its pipes.
- No action adds a column. A column is one edit on every line of the table.
- A table wider than the note measure scrolls the whole note sideways, and
  every other line of the note moves with it.
- The row that holds the caret shows its pipes, and the delimiter row opens
  when the caret reaches it, so the table changes shape under the caret.

## What the code holds today

[Decision 0002](../decisions/0002-widgets-only-where-text-cannot-express.md)
keeps a table as text: "Tables stay as text with alignment and column
decorations, so they remain editable in place." The set of widget kinds is
closed at an image, a Mermaid diagram and display math, and
`packages/editor/AGENTS.md` refuses any other widget.
[Decision 0025](../decisions/0025-the-live-preview-is-the-one-note-surface.md)
repeats that a table stays editable text on the one surface.

`packages/editor/src/live-preview.ts` reads the `Table`, `TableHeader`,
`TableRow`, `TableDelimiter` and `TableCell` nodes of the Lezer tree. It marks
each line of a table as a row and each stretch between two pipes as a cell,
hides the delimiter row while the selection is away from it, and shows the
pipes of the row that the selection touches.
`packages/editor/src/editor-theme.ts` draws each line as `display: table-row`
and each cell as `display: table-cell`. The rows of one table are neighbouring
line elements, so the browser groups them into one anonymous table. No element
holds the whole table, so nothing can scroll one table on its own, and the
wide table scrolls `.cm-scroller`, the scroller of the note.

The Table tool of `tableSpec` in `packages/editor/src/keymaps.ts` writes the
source with padded cells. Nothing keeps that padding right after an edit.

The root `AGENTS.md` keeps one CodeMirror editor instance for an open working
copy. `packages/editor/src/document-binding.ts` binds that one view to the Yjs
document of the note (record 0082), so undo, the gate for IME composition and
the work of another device all pass through that one view.

The published page and the export read the Markdown source through
`packages/markdown`, so no option below changes them.

## What a person needs

1. The table shows its outlines and its cells, and never a pipe or a dash.
2. A click into a cell puts the caret in that cell, at the end of its text.
3. Tab and Shift and Tab move to the next and the previous cell, and select
   its text. Tab in the last cell adds a row.
4. Enter moves to the cell below, and adds a row under the last one.
5. The arrow keys move inside a cell and then to the next cell. The caret
   never stands between two cells or outside the table.
6. A control adds a row or a column, and removes one, without the keyboard.
7. A wide table scrolls sideways inside its own outline.
8. The text of a cell keeps its inline Markdown: bold, a link, inline code.
9. Undo, redo, an IME composition, find and replace, and the work of another
   device behave in a cell as they do in a paragraph.
10. The note still stores portable GFM Markdown
    ([decision 0021](../decisions/0021-portable-markdown-at-rest.md)).

## The options

### Option A: a table widget with an editor in each cell

A block widget replaces the source of the table and draws a real HTML table.
Each cell holds a small editor of its own, or one editor follows the cell that
has the focus. An edit in a cell becomes a transaction on the note.

This is what most rich text products do, and it gives the widget full control
of the grid, the scroll box and the controls. The cost is high. A second editor
inside the note breaks the rule of one editor instance, and every guarantee of
record 0082 has to be built again for it: undo must reach the Yjs undo of the
note and not an undo of the cell, the IME gate must hold remote work while a
cell composes, and a remote edit of the table must re-render the widget without
losing the caret of the cell. Find and replace, the selection across cells, the
copy of a range and the reveal rule of the live preview do not reach text inside
a widget. The widget kind is new, so records 0002 and 0025 change. A cell that
is a plain input instead of an editor removes the second editor but shows the
inline Markdown of the cell as raw text, which fails need 8.

### Option B: a grid over the lines of the one editor

The table stays text in the one editor, and the editor presents it as a grid.

- A CodeMirror block wrapper (`EditorView.blockWrappers`, in the installed
  `@codemirror/view`) puts one element around the lines of each table. That
  element draws the outline and scrolls sideways on its own, which answers
  need 7. The rows inside it stay lines of the one editor.
- The pipes and the delimiter row never show. They keep their boxes, so the
  columns do not move, and they are atomic ranges, so the caret steps over
  them.
- A transaction filter holds the caret inside the text of a cell: a position
  in the padding or on a pipe moves to the nearest cell text, and a position
  on the delimiter row moves to the row below it.
- Table commands in `packages/editor` move between cells, add and remove a
  row and a column, and write the table again as aligned GFM. The difference
  is applied as the smallest character changes, in one transaction.
- The actions that add and remove a row and a column are tools of the
  formatting row of [decision 0094](../decisions/0094-the-note-has-one-row-of-formatting-tools.md).
  They join the row while the caret is in a table, and the command palette
  takes them from the same list. A control drawn on the table itself would be
  a widget, and the set of widget kinds stays closed.

Everything a person does in a cell is an edit of the one document, so undo,
IME composition, find and replace, the selection and remote work need nothing
new: need 9 holds by construction. The inline Markdown of a cell keeps its
live preview, which answers need 8. No widget kind is added, so the closed set
of decision 0002 holds. What changes is the part of 0002 that shows the source
of a table row under the caret: the row keeps its grid instead.

The cost is precision work in the text model. The filter that holds the caret
must never trap a selection that a person makes on purpose, for example a
selection from the paragraph above into the table. The rewrite of the padding
must leave a remote edit of the same row intact, which the Yjs merge does when
the rewrite touches only the spaces of the cells. Block wrappers arrived in
`@codemirror/view` 6.39, and two later releases fixed composition inside
them. The version that `packages/editor/package.json` pins holds both fixes,
so no dependency changes.

### Option C: fix the text table and keep the source

Keep the table as source, and fix the faults: the caret filter, Tab between
cells, Enter to add a row, and cells that wrap inside the measure so the note
never scrolls sideways. This is the smallest change. It fails need 1, because
the row under the caret still shows its pipes, and need 7, because a table
still cannot scroll on its own.

## Recommendation

Option B. It gives the person the grid that option A gives, and it keeps every
guarantee that the one editor and record 0082 already prove. Option A buys
nothing that a person sees over option B, and it pays for it with a second
editor. Option C does not answer the report.

## Answers of the owner

The owner chose option B on 2026-09-24. The row and column tools join the
formatting row only while the caret is in a table. The alignment colons of a
column stay as the source states them, and no tool sets them yet. A paste
into a cell becomes one line of that cell; a paste of many rows is later work.

## What this design does not do

It does not change the published page, the export, or the Markdown grammar.
It does not add merged cells, a formula, or a sort, because GFM has none of
them.

## Decisions

- [0095. A table is a grid over its text](../decisions/0095-a-table-is-a-grid-over-its-text.md)
