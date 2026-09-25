# 0106. A handle moves a list item

- Status: Accepted
- Date: 2026-09-25

## Context

The owner asks to drag the items of a task list to a new order
([issue 172](https://github.com/bkhanale/notesapp/issues/172)). A person can
only cut and paste the text today. `defaultKeymap` of CodeMirror binds Alt and
the arrow keys to a move of one line, so an item with a second paragraph or
with children leaves them behind, and a moved `1.` item makes the list start
at its own number (record 0089).

Record 0098 already moves a table row with a handle, through one edit of the
text, with a drag rule in `table-drag.ts` that knows nothing of tables. A
list item has no room of its own: a top-level item starts at the edge of the
column, and on a phone `.cm-content` keeps 8 px at that edge, so a handle
there is cut, which is the defect record 0098 fixed for tables.

## Decision

- A list item moves as whole lines: its marker line, its later lines and its
  nested lists, among the items of its own list. It never changes its level
  and never leaves its list. `packages/editor/src/list-move.ts` holds the rule
  and reads the items from the Lezer tree. Bullet, ordered and task items
  move alike.
- One move is one transaction of two changes: the item and the gap beside it
  leave, and they enter at the new place. The other items keep their text, so
  work of another device on them merges as before (record 0082).
- A moved ordered item takes the number of the place where it lands, so the
  list keeps its start. The renumber of record 0089 sets the others in the
  same transaction, so one undo puts the list back. A number that grows or
  shrinks moves the later lines of the item by the same width, through the
  one line rule of `list-numbering.ts`.
- With a mouse or a pen, a grip stands to the left of the item under the
  pointer. A drag of the grip moves the item, a line in the focus colour
  shows where it lands, and Escape cancels. The drag rule of record 0098
  moves to `pointer-drag.ts`, and the table and the list read it. The grip is
  a layer over the text, as the table handles are, so it adds no widget kind
  (record 0002) and the task box stays the control of record 0033.
- The grip shows only where the pointer can hover and is fine, and there the
  column keeps room for it at its start. One media query in
  `editor-theme.ts` states both, so the room and the grip cannot disagree. A
  touch screen shows no grip, because the room for a finger would move every
  line of every note on a phone.
- Every device moves an item with two tools of the formatting row, Move item
  up and Move item down, which apply only in a list item. The command palette
  takes them from the same list (record 0094), and Alt and the arrow keys run
  them. Outside a list those keys keep the line move of CodeMirror.

## Consequences

- A person orders a list with a mouse, a finger, the keyboard or the palette.
- An edit of another device inside the moved item at the same moment is
  lost, as it is for a table row, because a Yjs text has no move.
- `list-move.test.ts` holds the move, the numbers and the refusals.
  `pointer-drag.test.ts` holds the drag rule and the drop place.
  `keymaps.test.ts` and `format-toolbar.test.ts` hold the tools and the keys.
- It refines records 0094 and 0098.
