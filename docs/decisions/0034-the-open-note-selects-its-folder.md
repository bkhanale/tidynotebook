# 0034. The open note selects its folder

- Status: Accepted
- Date: 2026-09-15

## Context

Decision 0029 made one selected folder the parent of New note and New folder,
and it rejected deriving that parent from the open note because the result
would change without a visible selection. Two faults came out of that.

Nothing moved the selection when a person opened a note, so New folder made its
folder at the top while the person was reading a note three folders deep. The
selection also reset on its own: `apps/web/src/shell/files.tsx` emptied the
note list before every background read, the folder of the selection left the
tree for that moment, and `selectedFolderOrRoot` sent the selection back to the
root.

## Decision

Opening a note selects the folder that holds it.
`selectionForOpenNote` in `apps/web/src/lib/folder-selection.ts` states the
rule, and `apps/web/src/shell/shell.tsx` applies it on each open: when the path
of the open note changes, and when the person opens a note again from the tree
or the palette. The selection stays visible in the tree, so the parent of a
create action is still something a person reads before they act, which is what
0029 asked for. A person can still select any other folder, and the next note
they open moves the selection again, even when that is the note already on the
screen.

A folder the person makes is on the screen at once. The frame owns the open
folders of the tree, so the New folder dialog opens every folder above the one
it made. The row menu makes a folder inside a folder that nobody opened, and
that folder would otherwise land out of sight.

`selectedFolderOrRoot` runs only after the list of the area has answered, so a
list that is still loading never resets the choice of the person.

A background read that the quiet period holds runs when that period ends. A
person switches to this window once, so an event that is only dropped would
leave a list that nothing refreshes. `msUntilRevalidate` in
`apps/web/src/lib/revalidate.ts` states the wait.

A tab that comes back to the screen also starts a read, and a sync pass with
it. A window focus is not the whole signal: a browser gives a tab that becomes
visible again only the visibility event, so a person who returns to a tab would
otherwise read a list and a note that no event refreshes.

The folder row menu gains New folder in this folder, and the New folder dialog
states the parent it will use. This record refines decision 0029; it does not
replace it, because the selected folder is still the one create parent.

## Consequences

- New note and New folder land next to the note a person is reading.
- A background refresh of the note list cannot move the create parent.
- A person who wants another parent selects the folder row, or uses the menu of
  that row, and the dialog states which parent it took. The tree opens to show
  the new folder.
- `folder-selection.test.ts` holds both rules. A browser journey opens a note
  in a folder, makes a folder, and checks where it lands.
