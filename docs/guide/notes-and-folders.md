# Notes and folders

This page is for the person who writes the notes. It covers how to make,
name, move, find, and remove a note.

## Make a note

Select **New note** in the sidebar, or **New note in this folder** in a folder
menu, or **New note** in the command palette. The note opens at once with a
name such as `New note`, and the name is selected so you can type over it. A
new note is empty, and until you select Save it lives on your device only,
where the sidebar marks it **Local**.

## Name a note

The name is the large text at the top of the note. Select it and type. The name
is kept when you press **Enter** or select something else.

- A name needs no `.md` ending. If you type one it is removed, because every
  note is already a Markdown file.
- A slash in the name puts the note in a folder. `Work/Notes on the meeting`
  makes the folder `Work` if it does not exist yet.
- A backslash, an empty folder step, and a name another note already uses are
  all refused, with one sentence under the field. The last good name stays.

## Make a folder

Select the folder icon beside **New note**, or **New folder** in the command
palette. Type the name and select **Make folder**.

A folder is only a path. A new folder writes nothing to the server. It stays
visible on this device, becomes real as soon as a note lives in it, and
disappears again when it holds none.

## Move and rename

Drag a note or a folder onto another folder, or onto **All notes** to move it
to the top. The note menu, marked **More actions for this note**, also offers
**Move to folder**.

Renaming a folder renames the path of every note inside it, and the application
says how many notes that is before you confirm. A move is refused when a note
or a folder of that name is already there, and when a folder would move into
itself. The reason appears as one line in the sidebar.

## Find a note

Select **Search notes** in the header, or press **Ctrl + K**. Type a few words.
Notes whose name matches come first, then notes whose text matches, with a
short excerpt around the match. An empty box lists the notes you changed most
recently.

To search inside the note you have open, use **Ctrl + F** in the editor.

## Link one note to another

Type `](` to get a list of your notes, and select one to insert a link. `[[`
opens the same list and also inserts a normal Markdown link, so the file stays
readable in any other editor. Follow a link with **Alt + Enter**, or hold
**Ctrl** or **Cmd** and select it. There is no backlinks panel in this release.

## Remove a note

Open the note menu and select **Delete**, then **Confirm delete**. The note
moves to Trash and a bar offers **Undo** for a few seconds. See
[Trash](trash.md). There is no delete action for a folder.
