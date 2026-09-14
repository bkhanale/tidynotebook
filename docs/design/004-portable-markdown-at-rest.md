# 004: Portable Markdown at rest

Status: complete

This design states what a stored note is, and how the stored bytes become a file that a
person takes anywhere.

## The problem

The product promise is that nothing is stored that a person cannot take away as plain
Markdown. Export carries that promise today
([decision 0009](../decisions/0009-export-first-import-later.md)). The stored text does
not.

Two references in the text are specific to this application. A pasted image becomes
`![name](/attachments/<revision-id>)` (`apps/web/src/features/note-editor.tsx:857`),
and a note link can be `/notes/<file-id>` (`packages/markdown/src/links.ts`).
`classifyUrl` in `packages/markdown/src/policy.ts` accepts those two forms and
blocks every other relative path, so the policy holds the scheme in place.
Export then copies the text without a rewrite: it writes the image bytes to
`attachments/<revision-id>.<ext>` (`apps/server/src/http/export.ts:137`) and
leaves the reference alone, so every exported image is a dead link.

The application already holds half of the answer. The upload stores the image as a
real file at `attachments/<file-id>-<name>`, the file model has an attachment kind
(`packages/core/src/files/ports.ts:29`), and link completion writes a relative `.md`
path (`packages/editor/src/completion.ts`).

## Goals

The stored bytes are the portable file: what the store holds for a note is what the
person gets, character for character. Export is a copy and not a translation. A rename
never breaks a link, because the application rewrites each link that points at the moved
file, so the person keeps a stability that a folder of plain files cannot give.

## The options

**A. Portable text at rest.** The note text holds relative paths only: an image is a
file in the tree that the note names by a relative path, and a note link is a
relative `.md` path. This is the Obsidian model. The cost is the rename, because a
move must find and rewrite each note that points at the moved file, and the content
from 0.1.0 needs a one time rewrite.

**B. Identifiers at rest, translation at the edges.** The text keeps
`/attachments/<id>` and `/notes/<id>`, export rewrites them to relative paths, and
import rewrites them back. A rename stays free, because an identifier does not move.
The cost is that the promise becomes a property of one endpoint: the bytes in a
backup, a dump, or a later sync target stay specific to this application, and each
new way out of the product pays for the translator again.

**C. Wiki style links.** `[[Note name]]` survives a rename with no rewrite, because it
names a title and not a path. It is not CommonMark, so another reader shows the
brackets, and [decision 0004](../decisions/0004-standard-links-between-notes.md) refused it.

## The choice

Option A. The promise is about the stored file and not about one endpoint, so the
text is portable where it lives. Option B keeps a second grammar alive forever, and
option C fails the CommonMark test of decision 0004. Rename rewriting is the price
and it is also the feature: a folder of plain files cannot keep a link alive across a
rename, and this application can, because it owns the changeset that moves the file.

## The design

**An image becomes a file with a relative path.** The upload already writes the file
into the tree, and the insertion changes to the relative path of that file, seen from
the note. One `attachments/` folder at the workspace root holds them, and not a folder
beside each note, because the tree and the export already use that folder, it keeps
one place to look for an unused image, and a folder move then carries no image with
it. The cost is a longer `../` prefix for a deep note, which every Markdown reader
resolves. A note link is a relative `.md` path, which is what completion already
inserts, so its output becomes the one reference form. `classifyUrl` accepts a
relative path and refuses a path that leaves the tree.

**The resolvers take the note path.** The renderer and the live preview read no
storage ([decision 0003](../decisions/0003-read-mode-uses-the-shared-renderer.md)), so
they resolve a relative reference against the path of the note that holds it and pass
the result to the typed resolver that exists: `resolveAttachment` in
`packages/editor/src/widgets.ts:121` for an image, and `resolveLinkAction` in
`apps/web/src/features/note-link.ts` for a note, which matches a bare name today.

**The link index becomes path based.** `extractLinks` reports a relative destination,
and the index stores the resolved target path in place of the identifier. Backlinks
then work on standard links, which is what decision 0004 deferred. A move of a note,
an image, or a folder collects the notes that point at the moved path and rewrites
them in the same changeset. `renameFolderChangeset` in
`packages/core/src/files/operations.ts:167` already moves every member of a folder in
one changeset, so the rewrite joins an atomic write that exists.

**Export becomes a copy, and import becomes trivial.** Export walks the tree and writes
each note and each attachment at its stored path, with no reference rewrite. Import
writes a folder of `.md` files and its images to the tree at the same paths. Decision
0009 says that import is v0.2 unless it proves trivial after export lands. It does.

**A migration rewrites the 0.1.0 content.** One step reads the note content of every
workspace, maps `/attachments/<revision-id>` and `/notes/<file-id>` to the stored path of
that attachment or note, and writes the relative path. A reference that resolves to
nothing keeps its text and is reported. After it, another Markdown reader understands
every character of a note.

**Nothing is left out of the file on purpose.** History, trash, and the browser draft are
application state about a file and not content inside it, so they stay in the database.

## Risks

A rename on a large tree rewrites many notes inside one transaction, and a folder with
hundreds of inbound links makes one long write. The plan bounds the changeset and states
what happens above the bound.

A path carries case and a Unicode form, and a name has more than one normal form. The
resolver, the index, and the store need one rule of comparison, or a link resolves on
one machine and fails on another.

A relative path can leave the tree, and `../../../etc/passwd` is not a note, so the
policy refuses a resolved path that leaves the workspace root, and a unit test holds it.

## Decisions

- [0021. Portable Markdown at rest](../decisions/0021-portable-markdown-at-rest.md)
