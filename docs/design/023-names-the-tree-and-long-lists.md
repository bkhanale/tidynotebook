# Names, the file tree and long lists

Status: complete

## The problem

The audit of 2026-10-02 read the product as a person uses it, with a
workspace of 1010 notes, and three findings meet in the sidebar and in the
list of All notes.

A new note is named New note, New note 2 and so on. A person who starts a note
with a heading has already written its name, and the name stays New note until
the person types it a second time in the header. The list of All notes fills
with those names. Bear and Apple Notes take the name from the first line of
the note until the person gives the note a name of their own.

The tree of the sidebar is a tree that a pointer can use and little else. The
menu of a note row has one row, and that row says Delete when it moves the
note to Trash. No row has a context menu, no row renames with F2, and no
selection holds more than one row, so a person who wants to move ten notes
drags ten times. The tree has no tree semantics either: a screen reader hears
links and buttons in nested lists, and the arrow keys do nothing.

The list of All notes renders every row. With 1010 notes the page holds 11582
elements, and a move from a note to the list takes about 200 ms at the median.
The tree has the same cost when its folders are open, and the tree is on every
screen.

This design states the options and the cost of each one. It concludes in
three records. History, which the same audit names, is a smaller task and has
a record of its own that needs no design.

## A name that follows the first heading

### What the person expects

The person writes `# Trip to Lisbon` as the first line of a new note and
expects the note to be named Trip to Lisbon in the tree, in the list and in
the palette. If they later change the heading to `# Trip to Porto`, they
expect the name to follow, because they never chose a name: the heading was
the name. If they rename the note to Travel, the name is theirs and the
heading no longer moves it.

### Where the name can come from

Three sources are possible: the first line whatever it holds, the first
heading anywhere in the note, and the first line only when it is a heading.

The first line whatever it holds gives a name to every note, which is what
Apple Notes does. In Markdown the first line is often a list item, a task, a
quote or a fence, and the name of a note would read `[ ] call the bank` or a
line of code. The editor grammar of `packages/editor` names blocks but not a
paragraph, so a name from a paragraph needs a second reading of inline marks,
and record 0001 asks for one grammar.

The first heading anywhere surprises the person: a note that starts with a
paragraph and has a heading half way down takes the name of a section.

The first line, when it is a heading, is the case of the audit, it is how a
person who writes Markdown titles a note, and `previewStructureOf` of
`packages/editor` already reads a heading with its marks removed. A note that
starts with text keeps its name until the person names it. This design takes
that source.

### When the name follows and when it stops

A stored flag that says "named by the person" would need a field in the
contract, a column, a migration and a rule of the sync engine for two devices
that disagree. The name itself can carry the fact instead. A name is automatic
while it is the placeholder of a new note, New note or New note with a number,
or while it is the name that the heading gave, with the number that kept it
free in its folder. Any other name is the choice of a person, and the heading
does not move it. A rename in the header, in the tree or by import that gives
a name the heading does not give therefore stops the rule, with no state to
store and nothing to send.

The cost is a note whose name a person typed and that happens to equal its
heading: it follows the heading. That is the shape a person who sees the two
equal expects, and a rename to any other words ends it. A daily note is the
one exception. Its name is its date, which the calendar reads (record 0099),
so the rule never renames a daily note.

### When the rename happens

A rename at each keystroke writes a path for each letter of a heading and
moves the row in the tree while the person types. A rename at the boundary of
a version (record 0022), on a pause in typing, on leaving the note or on
Ctrl + S, writes one path for one finished heading, and the version that holds
the new heading holds the new name as well, so History shows one version and
not two. This design takes the boundary. The rule waits while the name field
holds words the person is typing.

### Collisions, links and two devices

A heading can name a note that its folder already holds. The rule takes the
first free name with a number after it, as New note does, so the domain never
refuses the save.

A rename changes the path, and a link to a note is a relative path (record
0004). The server already rewrites every portable link to a moved note when it
accepts the changeset, through `expandMovedReferences` in
`packages/storage-server/src/workspace-store/portable-links.ts` (record 0037).
A rename is a move of the last segment, so a link stays live with no new code.
A rename made with no connection waits in the queue with its version, and the
rewrite happens when the server accepts it.

Two devices that change the heading at the same time both rename at their next
boundary. The text merges (record 0081), the path of the later version wins,
and the next boundary of a device that still follows the heading brings the
name to the merged heading. No device can stop the rule for another, because
the rule reads only the name and the text that every device holds.

## The tree

### What a file tree of a desktop gives

The tree of Finder, of VS Code and of Obsidian shares one shape. Each row
selects on a click and opens on a click or Enter. Ctrl or Cmd with a click
adds a row to the selection, Shift with a click selects a range, and Shift
with an arrow key extends it. A right click, Shift + F10 and the Menu key open
a menu of the actions on the selection. F2 renames a row in place. Delete
moves the selection to Trash. The WAI-ARIA tree pattern states the keys and
the roles: one tree, one row in the tab order, the arrow keys move between
rows, Left and Right close and open a folder, and each row states its level,
its place among its siblings, and whether it is open and selected.

### Nested lists or one list of rows

The tree today is a list in a list for each open folder. The tree pattern does
not need that shape, and the window of a long list (below) cannot use it,
because a window over nested lists has a different offset in each list. One
list of the rows a person can see, each with its level, its place and its
count, serves both: the arrow keys walk the list, a screen reader reads the
level and the place, and a window cuts the list at any row. The cost is that
the indent of a level is a class of the row and not the nesting of the
document. `lib/tree-rows.ts` builds the list from the tree that
`buildNoteTree` returns and from the open folders.

### What the selection is

The tree marks two things today: the open note and the folder that a create
action uses (records 0029 and 0034). A selection of many rows is a third
thing. It is a set that the person builds on purpose, with a modifier key or
Space, and a plain click or Enter clears it and does what it does today. While
the set is empty, an action acts on the row it starts from. While the set holds
rows, a selected row takes the mark of a chosen row, and the open note keeps
its strong text and loses its fill, so a person reads one answer to "which
rows will this act on". The pure rules of the set are in
`lib/tree-selection.ts`.

### One table of actions

The menu of a row, the menu of a right click and the menu of Shift + F10 are
one menu. The note menu of the header (record 0069) and the menu of a note row
share their rows as well, so the words cannot drift: History, Publish, Rename,
Move to folder, Duplicate and Export as Markdown are one table in
`lib/note-menu.ts`, and Move to Trash is its pinned row. A note row adds Open
and Copy link. A folder row offers New note in this folder, New folder in this
folder, Rename, Move to folder, Publish folder and Move to Trash. A selection
of several rows offers Move to folder and Move to Trash, the two actions that
mean the same thing for each row.

Every action is an operation that already exists: `moveFiles` and
`trashFiles` of the local store (record 0032), `createNote` for Duplicate
(record 0104), the History route, the Publish dialog, the export of a note,
and the clipboard. No operation of the contract is added.

### Rename in place

F2 and the Rename row turn the name of the row into a field. Enter or a move
away keeps the name, Escape gives it back. A note keeps its folder and a
folder renames the path of every note inside it, through the same store
operation as Move to folder, so the open editor reads the new path from the
store. The Rename folder dialog is one more way to do the same write, and it
goes.

### Touch

A touch screen has no modifier key and no right click. The row keeps its
action button, which opens the same menu for the row. A selection of many rows
is for a keyboard and a pointer.

## A list of a thousand rows

### The cost

A row of the list is a list item, a link, an icon, a name and a time, about
ten elements. A thousand rows are ten thousand elements, and React builds,
diffs and lays them out on each move to the list. The person sees about
twenty-five of them.

### Options

`content-visibility: auto` lets the browser skip the layout of rows out of
view. It keeps every element in the document, so the count and the time React
spends do not move, and the audit counts both.

A window renders the rows in view and a few around them, and keeps the height
of the rest as space above and below them. Two ways to build one exist.

`@tanstack/react-virtual` is the common library. It measures each row, it
handles rows of many heights, and it is about 10 KB. Its documented use writes
the height and the offset of each row through a `style` attribute, which
`tools/check-design-rules.mjs` refuses, so it would need its own wrapper that
writes through a reference. It would be one more dependency of the first route
that record 0136 measures.

A small module of our own works because the rows of one list have one height:
a tree row, a list row and a menu row are one recipe (record 0065). The rule
is arithmetic over that height, the offset of the list in its scroller, and
the height of the scroller. It is a pure function that a unit test states at
every edge. One hook measures the height of a rendered row and writes two
numbers, the space above and the space below the window, through a reference.
That is the shape of record 0058, where one module decides the place of an
overlay and one module writes it. This design takes the module of our own.

### What a window takes away and what it keeps

Find in page finds only the rows in the document. The palette searches every
note, on the device and on the server, so it stays the way to find a note.

The focus stays on a row while the row is in the window. The tree keeps one
row in the tab order, and when that row is outside the window the first row of
the window takes its place, so Tab always reaches the tree. A row that takes
the focus is scrolled into view, and the window follows the scroll.

A screen reader hears the place of a row and the size of its list, through
`aria-posinset` and `aria-setsize` on each row, so the list reads as a list of
a thousand and not of forty.

All notes keeps its groups and its list of sections (record 0137): each group
is its own window inside the one scroller, and every heading stays in the
document, so a section row still finds its heading. The list keeps its scroll
offset for the session when the person opens a note and comes back.

## Decisions

- [0163, a new note takes its name from its first heading](../decisions/0163-a-new-note-takes-its-name-from-its-first-heading.md)
- [0164, the tree is one list of rows with a selection](../decisions/0164-the-tree-is-one-list-of-rows-with-a-selection.md)
- [0165, a long list renders a window of its rows](../decisions/0165-a-long-list-renders-a-window-of-its-rows.md)
