# Export

This page is for the person who writes the notes. It explains how to take your
notes out of Tidy Notebook.

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

Your browser downloads one zip file to its downloads folder, as any other
download, so a large workspace does not need the memory of the device. Inside
it:

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

The import takes the Markdown files and the images of the zip file. A hidden
file, such as `.ideas/plan.md`, is a note like any other, so a zip file of an
export comes back whole. The import leaves out two kinds of file:

- The settings of an app: the `.obsidian`, `.trash`, `.git` and `__MACOSX`
  folders, a `.DS_Store` file and a file whose name starts with `._`.
- Every file that is not a note or an image, such as a `.canvas` or a `.pdf`
  file.

When the import is done, the **Import** card counts the notes and the images
that came in. It also counts the files that it left out and names their kinds.

You can import an Obsidian vault as a zip file. The import puts each image that
is not in the `attachments` folder into that folder, and the links to the image
follow it. When that folder already holds an image with the same name, the
moved image gets a number after its name. A wiki link such as `[[Plan]]` or
`![[photo.png]]` becomes a normal Markdown link when the archive holds its note
or its image. The image in the folder of the note comes first. A wiki link to
something that is not in the archive stays as text.

An imported path must not be in use. If a path is in use, rename or remove that
file before you import the zip file again.

One zip file holds up to 65534 files and 4 GiB. **Export all notes** and
**Import workspace** both keep to that, so every zip file that an export writes
comes back through an import. A workspace that holds more cannot leave as one
zip file: the **Export** card says so, and you move some notes to another
workspace and export each one. When the server cannot take a zip file, the
**Import** card says why and what to do next.
