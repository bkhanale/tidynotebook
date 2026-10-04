# Saving and history

This page is for the person who writes the notes. It explains how a note saves
itself, how to bring an older version back, and what Review shows when two
devices change one note.

## The note saves itself

Typing writes your text to this device at once. A version is made for you when
you stop typing for a moment, when you leave the note, and when you switch to
another tab. **Ctrl + S**, or **Cmd + S** on a Mac, makes a version at once.
There is no Save button.

The versions go to your server when this device has a connection. The line at
the bottom of the sidebar tells you where your work is:

- **Sending your save to the server.** Your work is on its way.
- **No connection. Notes stay on this device.** Your work goes to your server
  when the connection returns.
- **1 save needs attention.** Your server refused a save. The save waits under
  **Needs attention**, below this line, and nothing sends it until you act.
- **Everything is saved to the server.** Your work is on your server.

## History

Open the note menu in the header and select **History**. The versions are
grouped by day, newest first. Each row says when that version was saved, for
example `Saved at 14:32`, and what changed, for example
`3 lines added, 1 line removed`. When two versions of one day were saved in
the same minute, their rows show the seconds too. A row that ends with
`with changes from another device` is a version that holds the work of two
devices. The newest version is marked **Current version**.

Select a row to open it. **Changes** shows the difference between that
version and the current version, line by line. **Preview** shows the version
as the note looked then, with its headings, task boxes, tables and pictures.
Use the arrow keys to move between the two. If the note is an image you see
the picture of that version.

## Restore

Select **Restore** on any row but the current version. The old text comes back
as a **new** newest version. Nothing is rewound and no version is removed, so you can always go
back again. History needs a connection.

## When two devices change the same note

You never choose between two texts. The work of both devices goes into the
note, and it appears in the open note on each device without a reload. Undo
takes back only what you typed on this device.

If your save went into the note together with changes that this device had
not seen, the note shows **This note has changes from another device.** Select
**Review** to see what changed: the text of your save beside the note now, line
by line. Opening Review, or selecting **Dismiss**, closes the notice on this
device only. A later change from another device can show it again.

## Needs attention

A save that your server refuses for good is kept on your device and listed
under **Needs attention** in the sidebar, which appears only while something is
waiting there. Each row says why, says when the text was kept, shows the text,
and offers four actions: **Retry**, **Save as new note**, **Copy text**, and
**Discard**. **Retry** sends the text again. When the note already holds that
text, Retry sends the note as it is now, so you keep your later changes. When
no save waits there any more, the line at the bottom of the sidebar states your
other work again.

You can also change the note itself. For example, when the row says "Divide
the paragraph.", divide the paragraph in the note. Your next save goes to your
server with all of your text, and the row goes away. A new note never takes the
name that a waiting save still holds on your server.

After an update of tidy notebook, earlier work on this device that could not go into
its note waits there too. That note shows a notice, and its Review compares the
earlier work with the note now and opens Needs attention.
