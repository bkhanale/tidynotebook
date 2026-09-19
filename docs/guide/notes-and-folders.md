# Notes and folders

This page is for the person who writes the notes. It covers how to make,
name, move, find, and remove a note.

## Make a note

Select **All notes** or a folder name to choose where a new note goes. Then
select **New note** in the sidebar or in the command palette. You can also use
**New note in this folder** in a folder menu. The note opens at once with a
name such as `New note`, and the name is selected so you can type over it. A
new note is empty, and until you select Save it lives on your device only. The
sidebar marks it **Local**.

## Name a note

The name is the last part of the line at the top of the screen. Select it and
type. The name is kept when you press **Enter** or select something else.

- A name needs no `.md` ending. If you type one it is removed, because every
  note is already a Markdown file.
- A name holds only the file name. It cannot contain a slash. Use Move to
  folder to place the note in a folder, or New note in this folder to make a
  note that starts there.
- A backslash and a name another note already uses are refused, with one
  sentence on the note. The last good name stays.

## Make a folder

Select **All notes** or a folder name to choose the parent. Then select the
folder icon beside **New note**, or **New folder** in the command palette. Type
one child name and select **Make folder**. Select the chevron beside a folder
to expand or collapse it.

A folder is only a path. A new folder writes nothing to the server. It stays
visible on this device, becomes real as soon as a note lives in it, and stays
after a note delete.

## Move and rename

Drag a note or a folder onto another folder, or onto **All notes** to move it
to the top. The note menu in the header, marked **Note actions**, also offers
**Move to folder**.

Renaming a folder renames the path of every note inside it, and the application
says how many notes that is before you confirm. A move is refused when a note
or a folder of that name is already there, and when a folder would move into
itself. The reason appears as one line in the sidebar.

## Find a note

Select **Search** in the header, or press **Ctrl + P**. Type a few words.
Notes whose name matches come first, then notes whose text matches, with a
short excerpt around the match. An empty box lists the notes you changed most
recently.

To search inside the note you have open, use **Ctrl + F** in the editor.

## Link one note to another

Type `](` to get a list of your notes, and select one to insert a link. `[[`
opens the same list and also inserts a normal Markdown link, so the file stays
readable in any other editor. Follow a link with **Alt + Enter**, or hold
**Ctrl** or **Cmd** and select it.

## See what links to a note

**Links to this note** is at the side of the open note. It lists the notes that
link to it. Select a name to open that note. Select the title of the list to
collapse it or to open it again. A note that nothing links to says that no
notes link here.

The list works without a connection, because this device reads your notes and
answers. It then says that the links come from this device. A link that you
type is in the list before you save it. A narrow window hides this side panel.

## Remove a note or a folder

Open the row menu of a note and select **Delete note**. Open the row menu of a
folder and select **Delete folder**. The action runs at once. A bar offers
**Undo** for a few seconds. A folder action moves every note under the folder
to Trash. See [Trash](trash.md).
