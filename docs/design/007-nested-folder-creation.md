# 007: Nested folder creation

Status: complete

This design states how the folder tree selects the parent for a new note or a
new folder.

## The problem

The domain accepts a note path with many folder parts. The tree in
`apps/web/src/lib/note-list.ts` also renders every level. The main New note and
New folder actions in `apps/web/src/shell/shell.tsx` always create at the root.
The only way to put a new note in a folder is the menu on that folder. There is
no way to create a child folder from the main action.

The tree also uses one folder button to expand or collapse a row. It has no
selected-folder state. The application therefore has no parent that both main
create actions can use.

## The options

**Option A. Store folders as server records.** A selection can point at a
folder identifier. This adds a new domain entity, a contract operation, and a
database shape. It also changes the current rule that a folder is a part of a
note path. The cost is too large for a client creation problem.

**Option B. Keep a selected relative folder path in the shell.** The root uses
an empty path. A folder name button selects its full path and opens that row. A
separate button controls expansion. Both main create actions use the selected
path. The state is temporary, because it controls the current view and not the
stored note model. This option uses the path rules that already exist.

**Option C. Derive the parent from the open note.** The main actions use the
folder of the open note. This needs no new tree state, but the result changes
when a person opens a note. It also gives no visible selection before an
action. This behavior is not clear enough.

This design takes Option B. It adds one visible state and does not change the
domain, the contract, or storage.

## The changes

`apps/web/src/shell/shell.tsx` owns the selected folder path. The root row and
each folder name can select a parent. The selected row has an active state and
an accessible pressed state. The folder chevron keeps expansion as a separate
keyboard action.

`apps/web/src/features/notes/new-note.tsx` accepts the selected parent for the
main button. `apps/web/src/features/folders/folders.tsx` joins one clean child
name to that parent. A folder name cannot contain a slash, because one action
makes one child.

The command palette uses the same parent for its New note action. If the
selected path is no longer in the tree after a rename, a move, or a delete,
the shell selects the root.

## Risks

A selected folder can disappear while a move or a sync changes the tree. A
pure selection rule resets an unavailable path to the root. Unit tests hold
that rule.

A nested empty folder exists only on the current device until it holds a note.
This is the existing empty-folder model. The browser test creates a note in the
child and checks the saved server path, so the durable result does not depend
on that temporary entry.

## Decisions

- [0029. The selected folder is the create parent](../decisions/0029-selected-folder-is-the-create-parent.md)
