# 0164. The tree is one list of rows with a selection

- Status: Accepted
- Date: 2026-10-02

## Context

The tree in `apps/web/src/shell/shell.tsx` is a list in a list for each open
folder. A note row has one menu row, named Delete, that moves the note to
Trash (issue 245). No row has a context menu or renames with F2, no selection
holds more than one row (issue 255), and the tree has no tree role. See
[design 023](../design/023-names-the-tree-and-long-lists.md).

## Decision

- `apps/web/src/lib/tree-rows.ts` turns the tree of `buildNoteTree` and the
  open folders into one list of visible rows, each with its level, its place
  and the count of its siblings. `apps/web/src/shell/tree.tsx` renders it as
  the WAI-ARIA tree: `role="tree"` with `aria-multiselectable`, and a
  `treeitem` for each row with `aria-level`, `aria-posinset`, `aria-setsize`,
  `aria-expanded` and `aria-selected`. One row is in the tab order.
- The keys: the arrows, Home and End move the focus, Right and Left open and
  close a folder, Enter opens, Space and Ctrl or Cmd with a click add a row to
  the selection, Shift with a click or an arrow selects a range, Ctrl or Cmd +
  A selects every row, Escape clears the selection, F2 renames, Delete moves
  the selection to Trash, and Shift + F10 and the Menu key open the menu.
  `apps/web/src/lib/tree-keys.ts` and `apps/web/src/lib/tree-selection.ts`
  hold the rules.
- A plain click or Enter clears the selection and does what it did: a note
  opens, a folder becomes the create parent (records 0029 and 0034).
- One table gives the menu of a row, of a right click and of the keys:
  `apps/web/src/lib/note-menu.ts` for a note, shared with the note menu of
  the header, and `apps/web/src/lib/tree-actions.ts` for a folder and a
  selection. Move to Trash is the one label of the move to Trash on every
  surface, and `apps/web/src/lib/note-menu.test.ts` refuses another.
- F2 and Rename turn the name into a field in the row. A rename, a move of a
  selection and a drag of a selection are one `moveFiles` of the local store,
  and Move to Trash is one `trashFiles` (record 0032). The Rename folder dialog
  is removed. `MoveItemsDialog` in `apps/web/src/features/folders/folders.tsx`
  moves one note, one folder or a selection.
- Only operations that exist are offered. No contract operation is added.

This refines records 0029, 0034 and 0093, and it excludes a nested list of
lists and a second menu of a row.

## Consequences

- A person moves or trashes many notes at once, from the keyboard as well.
- A touch screen keeps the action button of a row and has no selection of
  many rows.
- The unit tests of `tree-rows.ts`, `tree-keys.ts`, `tree-selection.ts`,
  `tree-actions.ts` and `folder-moves.ts` hold each rule.
