# 013: Conflict-free sync of note text

Status: active

This design states how two devices that edit one note, online or offline,
reach one note that holds the work of both. It answers issue 152, and it
reopens the resolution that
[record 0024](../decisions/0024-remove-conflict-and-recovery-surfaces.md) and
[record 0026](../decisions/0026-slim-the-save-and-delete-surfaces.md) chose.

## The problem

A person writes on a laptop with no connection. The same note changes on a
phone that is online. When the laptop comes back, the product must keep both
edits in the note. Today it keeps one edit in the note and moves the other to
History.

This is the first thing a person tests when they compare Markdown notes
applications. An application that loses a paragraph once, even to History,
loses the trust of that person. The owner closed this question for version 0.1
because the application was not stable enough to carry a conflict model. It is
stable now, so the owner rejects that resolution and asks for the industry
standard.

## What the code does today

Five facts decide most of this design. Each one was read in the source.

**A note is a chain of whole-text revisions.** A save is a changeset. Each
revision carries the full Markdown, a digest of it that the client computes,
and the parent it was written over. `commitChangeset` in
`packages/core/src/files/commit.ts` accepts it, and the tables of
`packages/storage-server/src/schema.ts` keep it. History, search, backlinks,
export and the published page all read that stored Markdown.

**A save over an older head replaces the newer text.** `rebaseHeads` in the
same file puts the late save on top of the current head. The head it passed
becomes a History entry, and `announceSuperseded` in
`packages/sync/src/queue.ts` gives the person one notice. No text is deleted,
but the text of the other device leaves the note.

**The device sends before it reads.** One cycle of
`packages/sync/src/engine.ts` pushes the queue first and pulls the change feed
second. A device that saved versions offline therefore sends them before it
learns that the note moved. No client logic can compare the three texts in
time, whatever it does with them.

**Drafts and versions are local rows.** `packages/storage-browser` keeps a
draft per working copy and an immutable checkpoint per version, and
`expectedHeadOfParent` in `local-store/shared.ts` names the precondition of a
save ([record 0073](../decisions/0073-a-save-names-the-revision-it-descends-from.md)).

**One editor instance holds the note.** `apps/web/src/features/editor/note-editor.tsx`
builds one CodeMirror view per working copy and never replaces its document.
Any merge must reach that view as a change, not as a new document.

## The first question: merge or never conflict

There are three families of solution in the market.

**Conflict copies.** Bear, Joplin and Standard Notes write the second version
as a second note. Nothing is lost, and the person merges by hand every time.
This is the weakest experience, because every overlap and every false overlap
becomes work.

**Three-way merge.** Obsidian Sync compares the common base, the local text
and the remote text, and merges them with a character diff. It is the default
of that product. Its own documentation says that the merge can create
duplicate text or broken formatting that the person must fix, and it offers a
conflict file as a setting. A three-way merge needs the common base on every
device, and it gives an answer only for the pair of versions it sees. Three
devices, or two merges in a different order, can give two different notes.

**A conflict-free replicated data type (CRDT).** Notion, Apple Notes and Craft
keep the text as a structure in which every inserted character has an identity
and every edit is an operation. Any device applies the operations of any other
device, in any order, as often as it likes, and every device reaches the same
text. There is no text conflict to resolve, because two edits of the same
place both survive.

This design chooses a CRDT. It is the only family that gives the same note on
every device for every order of arrival, with no base text to keep and no
prompt. It also turns the save of a note into a small delta instead of the
whole text, and it makes live editing on two devices a later feature instead
of a second rewrite.

A CRDT has one weakness that this design must answer. When two devices rewrite
the same sentence, the result holds the characters of both. The text can read
badly, and it is never lost. The fourth question answers that case.

## The second question: which library

Three libraries are mature enough to consider. Each has a binding for
CodeMirror.

**Yjs.** The most used CRDT library in JavaScript. It is plain JavaScript with
no WebAssembly, it is small, and it has an undo manager that tracks only local
edits. Its CodeMirror binding is stable on the current major line, and the
next major line with its new binding is still a release candidate. The cost is
that the project adopts a line that is about to change, or waits.

**Automerge.** A Rust core compiled to WebAssembly, with a full change history
inside the document. Its CodeMirror binding is built around its own repository
and network layer, which duplicates the sync engine this product already has.
The WebAssembly module is a large addition to the first load, which
[record 0044](../decisions/0044-the-worker-stays-out-of-the-first-load.md) and
the precache rules protect.

**Loro.** A Rust core compiled to WebAssembly. Its text algorithm is designed to
keep two concurrent insertions at one place apart instead of interleaving
them, which is exactly the weak case above. It has version history and an undo
manager. It is the youngest of the three, with the smallest community.

The design does not choose a library by argument. A short spike decides, on
these criteria, in this order:

1. Two insertions at one place, and a deletion against an edit, give text that
   a person can read and repair.
2. The binding keeps one CodeMirror instance, the selection, an active
   composition, and an undo history of local edits only.
3. The server can apply, merge and materialize a document in Node with no
   browser.
4. The cost to the first load and to the precache.
5. The maintenance record of the library and of its binding.

Whatever the choice, the library sits behind one small module that the rest of
the product reads, so a later change of library touches one package. The
second record below names that package.

## The third question: where the CRDT sits

**Option A: the CRDT replaces revisions.** The note becomes an update log, and
History becomes a list of snapshots. This is the pure form. It rewrites the
contract, the commit rules, the server tables, the browser tables, History,
the restore and the change feed at once.

**Option B: the CRDT rides inside revisions.** A changeset keeps its shape. A
revision of a note carries the CRDT update since the state its device last
saw, instead of the whole text. The server keeps one CRDT document per note,
applies each update, and writes the Markdown of the result as the content of
the revision. Two saves that were made at the same time both apply, in either
order, to the same result, so the server never rebases text and never
supersedes a head. History, search, backlinks, export and the published page
keep reading stored Markdown and do not change.

**Option C: the client merges before it sends.** The engine pulls before it
pushes, the device merges on its own, and the server refuses a save over an
older head. This keeps the server unaware of the CRDT. It leaves two sources of
the Markdown of a note, and a device with a defect can store Markdown that its
own document does not hold.

This design chooses option B. It keeps every reader of stored Markdown as it
is. It makes the server the one writer of the Markdown of a note, so the
stored text and the document can never disagree. And it keeps the changeset,
the receipt and the change feed that the sync engine already proves.

Option B changes three rules of today. A client no longer computes the digest
of the content, because the server writes the content. A revision of a note
states the updates it carries, and the answer names the digest of the result.
And a revision that the server applied over a head its device had not seen
records both parents, so History shows that two lines of work joined there.

## The fourth question: what the person sees

A text merge needs no decision, so the product asks for none. The work of the
other device appears in the open note as a change of the one editor. The
selection stays where it was, and undo reverses only the edits of this
device.

A merge after a device was offline is still something the person must be able
to check. The note then shows one quiet line: this note changed on another
device while this device was offline, with a Review action. Review opens a
comparison of the text this device held before it came back with the text
after the merge, built on the unified diff that History already uses. The
person edits the note to fix what reads badly. Nothing waits for them.

This design rejects a screen that holds the save until the person chooses. That
screen keeps the work of one device on that device alone until somebody acts.
A lost laptop then loses the work. The other devices cannot see the problem,
and cannot help. None of the leading applications holds text this way.

## The fifth question: conflicts that are not text

A CRDT merges text. A file also has a path and a deletion state, and those are
single values. Each one needs one rule, and one notice when it applies.

- **Two renames.** The rename that the server accepts last wins. The other name
  stays in History. The person reads one notice.
- **A deletion against an edit.** The edit wins. An edit made on a device that
  did not know of the deletion brings the note back from Trash with the merged
  text, and the person reads one notice. This keeps the intent of record 0026,
  and it replaces the recovered copy of that record with the note itself.
- **Two new notes at one path.** Both notes stay. The second takes the next free
  name, and the person reads one notice.
- **A folder move against an edit inside it.** These do not touch each other and
  both apply.

## The sixth question: History and restore

A revision stays an immutable state of the file with stored Markdown, so
History reads as it does today. A restore becomes an edit: the server turns the
difference between the current text and the chosen revision into operations,
and applies them. A restore therefore merges with an edit that another device
made offline, as any edit does, instead of replacing it.

Automatic versions of
[record 0022](../decisions/0022-autosave-and-automatic-versions.md) stay. A pause
in typing still ends one save. The save now carries the operations of that
pause instead of the whole note.

## The seventh question: the first state of a document

A CRDT document must start once, from one writer. Two devices that each build a
document from the same Markdown make two sets of character identities, and a
merge of the two holds the text twice. This is the most common defect of a CRDT
adoption, so the design makes it impossible by construction.

- The server builds the document of every existing note from its head, once, in
  a migration. A device receives the document with its snapshot and never
  builds one from Markdown.
- A new note starts on the device that creates it, which already assigns the
  file identity. The first save carries the first state.
- An import builds its documents on the server.
- A device that holds work from before the change, as a draft or a queued
  version, turns that work into operations over the document it receives, once,
  with a three-way diff against the head it started from. This is the one place
  that compares texts, and it runs one time per device.

## Limits and validation

A CRDT document keeps a record of deleted characters, so it grows faster than
its text. The server bounds the size of one update and of one document, and it
compacts a document when it passes a bound. The limit of the note size applies
to the Markdown of the result, as it does now. The server decodes every update
under those bounds and refuses a malformed update before it applies it, and
the Markdown it writes passes the rules of
[record 0021](../decisions/0021-portable-markdown-at-rest.md). The row access
rules do not change.

A device that stays offline for a long time sends operations against an old
state, and they still apply. No save expires.

## What stays out

- **Live editing on two devices at once.** The CRDT makes it possible. It needs
  a push channel that the contract does not have, so it is a later design.
- **Presence and cursors of other devices.** The same.
- **Attribution colours in the text.** The Review comparison covers the need.
  A colour for each device is a later choice.
- **Attachments.** An attachment is immutable bytes. It has no text to merge,
  and its rules do not change.

## The cost

This is the largest change since the version 0.1 revamp. It changes the save
model, adds a package, changes the contract of a save and of the change feed,
changes the server tables and the browser tables, and migrates every note. It
touches `packages/core`, `packages/sync`, `packages/storage-browser`,
`packages/storage-server`, `apps/server`, `packages/api-contract`,
`packages/editor` and `apps/web`. The rules of the root `AGENTS.md` about
drafts and versions change with it.

The order of the work reduces the risk. The spike comes first and decides the
library. The server side comes next, behind the contract, with a real database
test that merges two devices. The browser store and the engine follow. The
editor binding comes last, because it is the part a person sees and it depends
on everything before it.

## Questions for the owner

1. Does the owner accept option B, the CRDT inside revisions, over option A?
2. Does a deletion against an edit bring the note back from Trash, as this
   design proposes, or keep a recovered copy as record 0026 does?
3. Does the Review line appear on every device that holds the note, or only on
   the device that was offline?

## Decisions

No record exists yet. After the owner answers the questions above and the
spike reports, this design concludes in these records:

- The text of a note is a CRDT document. It supersedes records 0024 and 0026
  for text, and refines records 0022 and 0073.
- The CRDT library, and the one package that wraps it.
- The server is the one writer of the Markdown of a note, and a revision can
  record two parents.
- The rules for a conflict that is not text.
- The Review of a merge is the one conflict surface.
- A document starts once, and the migration of every existing note.

An earlier line merge for issue 152 was drafted and parked. It never landed,
and this design replaces it.
