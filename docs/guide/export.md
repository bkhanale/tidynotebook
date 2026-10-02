# Export

This page is for the person who writes the notes. It explains how to take your
notes out of NotesApp.

Nothing is stored that cannot leave as plain Markdown files. Export needs a
connection, because it reads the versions your server accepted.

## One note

Open the note menu in the header, the one marked **Note actions**, and select
**Export as Markdown**. The note downloads as one `.md` file named after the
note.

## Copy one note

Open the command palette with **Ctrl + P**, or **Cmd + P** on a Mac, and
select **Copy this note as Markdown**. The whole text of the open note goes to
the clipboard as Markdown. You do not have to select text first.

The copy holds the text that you see, which includes text that you have not
saved yet. It does not need a connection. A browser that has no clipboard,
such as one that opens the application over plain HTTP, cannot copy the note.
Use **Export as Markdown** there.

## Every note

Open **Settings** from the header menu and find the **Export** card. Select
**Export all notes**.

You get one zip file. Inside it:

- every note as a `.md` file, at its folder path, so your folders come out as
  folders;
- an `attachments` folder holding your live images.

The files are ordinary Markdown. They need no application to be read again.

## What an export holds

An export holds the versions your server accepted. It does not hold:

- text on this device that you have not saved yet;
- notes in Trash;
- earlier versions from History.

Save first if you want your newest text included, and restore anything you need
from Trash before you export.

## Import

Open **Settings** from the header menu and find the **Import** card. Select
**Import workspace**, then select a zip file that contains Markdown files and
images. The import keeps each file path and each relative link.

An imported path must not be in use. If a path is in use, rename or remove that
file before you import the zip file again.

One import takes a zip file of up to 100 MiB that holds up to 65535 files.
Every zip file that **Export all notes** writes holds no more files than that,
so a workspace can always come back through its own export when its files fit
in 100 MiB. For a larger set, put the files in two or more zip files and import
each one. When the server cannot take a zip file, the **Import** card says why
and what to do next.
