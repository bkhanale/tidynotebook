# Export

This page is for the person who writes the notes. It explains how to take your
notes out of NotesApp.

Nothing is stored that cannot leave as plain Markdown files. Export needs a
connection, because it reads the versions your server accepted.

## One note

Open the note menu, the one marked **More actions for this note**, and select
**Export as Markdown**. The note downloads as one `.md` file named after the
note.

## Every note

Open **Settings** from the header menu and find the **Export** card. Select
**Export all notes**.

You get one zip file. Inside it:

- every note as a `.md` file, at its folder path, so your folders come out as
  folders;
- an `attachments` folder holding the images that those notes use.

The files are ordinary Markdown. They need no application to be read again.

## What an export holds

An export holds the versions your server accepted. It does not hold:

- text on this device that you have not saved yet;
- notes in Trash;
- earlier versions from History.

Save first if you want your newest text included, and restore anything you need
from Trash before you export.

## Import

There is no import in this release. See
[decision 0009](../decisions/0009-export-first-import-later.md).
