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
- **No connection. Saves wait on this device.** Your work goes to your server
  when the connection returns.
- **Everything is saved to the server.** Your work is on your server.

## History

Open the note menu in the header and select **History**. Each row says when that
version was saved and what changed, for example `3 lines added, 1 line removed`.
A row that ends with `with changes from another device` is a version that holds
the work of two devices.

Select a row to open it. You get the difference between that version and the
newest one, line by line, and the whole text of that version under **Whole text
of this version**. If the note is an image you see the picture of that version.

## Restore

Select **Restore** on any row. The old text comes back as a **new** newest
version. Nothing is rewound and no version is removed, so you can always go
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
waiting there. Each row says why, shows the text, and offers four actions:
**Retry**, **Save as new note**, **Copy text**, and **Discard**.

After an update of Notesapp, earlier work on this device that could not go into
its note waits there too. That note shows a notice, and its Review compares the
earlier work with the note now and opens Needs attention.
