# Notes and folders

This page is for the person who writes the notes. It covers how to make,
name, sort, move, find, and remove a note.

## Make a note

Select **All notes** or a folder name to choose where a new note goes. Then
select **New note**, the plus button above the tree, or **New note** in the
command palette. You can also use **New note in this folder** in a folder
menu. The note opens at once with a name such as `New note`, and the cursor is
in the note, so you can write at once. A new note goes to your server when a
connection is there. Until then the sidebar marks it **Local**.

## Name a note

Start a new note with a heading, for example `# Trip to Lisbon`. When you
pause, the note takes the heading as its name. While the name is still the
name that the heading gave, it follows the heading when you change it. When
the folder already holds a note of that name, the note takes the name with a
number after it, for example `Trip to Lisbon 2`. A note that starts with text
and not with a heading keeps its name. Links to the note from other notes
follow a new name.

To give a note a name of your own, select the name, which is the last part of
the line at the top of the screen, and type. The name is kept when you press
**Enter** or select something else. **Enter** then puts the cursor in the
note. Press **Escape** to keep the name that the note had. A name that you
type stays when the heading changes. A daily note keeps the name of its date.

- A name needs no `.md` ending. If you type one it is removed, because every
  note is already a Markdown file.
- A name holds only the file name. It cannot contain a slash. Use Move to
  folder to place the note in a folder, or New note in this folder to make a
  note that starts there.
- A backslash and a name another note already uses are refused, with one
  sentence on the note. The last good name stays.

## Make a folder

Select **All notes** or a folder name to choose the parent. Then select
**New folder**, the folder button beside **New note**, or **New folder** in the
command palette. Type one child name and select **Make folder**. Select the
chevron beside a folder to expand or collapse it.

**Expand all folders**, the last button above the tree, opens every folder.
When a folder is open, the same button is **Collapse all folders** and closes
every folder.

A folder is only a path. A new folder writes nothing to the server. It stays
visible on this device, becomes real as soon as a note lives in it, and stays
after a note delete.

## Sort the notes

Select **Sort notes** above the tree and select an order:

- **Name, A to Z** and **Name, Z to A** put the notes in alphabet order.
- **Date created, Newest first** and **Date created, Oldest first** use the
  time you made each note.
- **Date updated, Newest first** and **Date updated, Oldest first** use the
  time you last changed each note.

The order applies to the notes in each folder. Folders stay above the notes,
in alphabet order from A to Z. This device keeps your order until you select another one.

## The menu of a row

Each row of the tree has a menu. Open it with the button at the end of the
row, with a right click on the row, or from the keyboard with **Shift + F10**
or the **Menu** key.

- A note row offers **Open**, **History**, **Publish**, **Rename**,
  **Move to folder**, **Duplicate**, **Copy link**, **Export as Markdown** and
  **Move to Trash**. **Copy link** puts the address of the note on the
  clipboard. The address opens the note for a person who signs in to your
  account. To share a note with other people, use **Publish**.
- A folder row offers **New note in this folder**, **New folder in this
  folder**, **Rename**, **Move to folder**, **Publish** and **Move to Trash**.

## Move and rename

Drag a note or a folder onto another folder, or onto **All notes** to move it
to the top. **Move to folder** in the menu of a row, and in the note menu in
the header, marked **Note actions**, does the same with the keyboard.

To rename a row, select it and press **F2**, or select **Rename** in its menu.
The name becomes a field in the row. Press **Enter** to keep the new name, or
**Escape** to keep the old one. Renaming a folder renames the path of every
note inside it. A move or a rename is refused when a note or a folder of that
name is already there, and when a folder would move into itself. The reason
appears as one line in the sidebar.

## Select several notes

Hold **Ctrl**, or **Cmd** on a Mac, and select rows to add them to a
selection. Hold **Shift** and select a row to select every row between it and
the last row you selected. **Shift + Down** and **Shift + Up** do the same
from the keyboard, **Space** adds the row that has the focus, and **Ctrl + A**
selects every row. The open note is part of the selection when you start it.

The menu of a selected row then acts on the whole selection: **Move to folder**
moves every selected note and folder, and **Move to Trash** moves them all to
Trash. You can also drag a selected row to move the whole selection. Press
**Escape** to clear the selection. A plain select of a row also clears it.

## Move through the tree with the keyboard

The tree takes one stop of **Tab**. **Up** and **Down** move between rows,
**Home** and **End** go to the first and the last row, **Right** opens a
folder and **Left** closes it or goes to the folder above. **Enter** opens a
note or selects a folder. **Delete** moves the selection to Trash.

## Find a note

Select **Search** in the header, or press **Ctrl + P**. Type a few words.
Notes whose name matches come first, then notes whose text matches, with a
short excerpt around the match. An empty box lists the notes you changed most
recently.

Search works the same in every language. Each word also finds the longer words
that start with it, so `plan` finds `planning`. A letter with an accent finds
the same letter without one, so `cafe` finds `café`. Search reads the text as
you see it in Read mode, so a link address and a Markdown mark do not count.

To search inside the note you have open, use **Ctrl + F** in the editor.

## Link one note to another

Type `](` to get a list of your notes, and select one to insert a link. `[[`
opens the same list and also inserts a normal Markdown link, so the file stays
readable in any other editor.

You can also type a whole wiki link, such as `[[Plan]]`, `[[Plan|the plan]]`
or `[[Plan#Next steps]]`, as you do in Obsidian. When you type the last `]`
and a note of that name is in the workspace, the editor changes it to a normal
link. A paste does the same. A wiki link that names no note stays as you
wrote it.

Select a link to open it. The pointer changes over a link, so you can see what
one click does. To change the text of a link, move the cursor into it with an
arrow key, or select the text beside it. The link then shows its Markdown
source and you can edit it. **Alt + Enter** opens the link at the cursor.

## See what links to a note

**Links to this note** is at the side of the open note. It lists the notes that
link to it. Select a name to open that note. Select the title of the list to
collapse it or to open it again. A note that nothing links to says that no
notes link here.

The list works without a connection, because this device reads your notes and
answers. It then says that the links come from this device. A link that you
type is in the list before you save it. A narrow window hides this side panel.

## Remove a note or a folder

Open the menu of a note row or a folder row and select **Move to Trash**, or
press **Delete** in the tree. The note menu in the header and the command
palette offer the same action for the open note. The action runs at once. A
bar offers **Restore** for a few seconds. A folder action moves every note
under the folder to Trash. See [Trash](trash.md).
