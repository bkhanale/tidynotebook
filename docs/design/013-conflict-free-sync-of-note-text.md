# 013: Conflict-free sync of note text

Status: active

This design states how two devices that edit one note, online or offline,
reach one note that holds the work of both. It answers issue 152. It replaces
the resolution that
[record 0024](../decisions/0024-remove-conflict-and-recovery-surfaces.md) and
[record 0026](../decisions/0026-slim-the-save-and-delete-surfaces.md) chose for
text, and it decides every question it raises.

## The problem

A person writes on a laptop with no connection. The same note changes on a
phone that is online. When the laptop comes back, the product must keep both
edits in the note. Today it keeps one edit in the note and moves the other to
History.

This is the first thing a person tests when they compare Markdown notes
applications. An application that loses a paragraph once, even to History,
loses the trust of that person. The owner closed this question for version 0.1
because the application was not stable enough to carry a conflict model. It is
stable now. The owner rejects that resolution and asks for the industry
standard, built once and built well.

## What the code does today

Six facts decide this design. Each one was read in the source.

**A note is a chain of whole-text revisions.** A save is a changeset. Each
revision carries the full Markdown, a digest that the client computes, and the
parent it was written over. `commitChangeset` in
`packages/core/src/files/commit.ts` accepts it, and the tables of
`packages/storage-server/src/schema.ts` keep it. History, search, backlinks,
export and the published page all read that stored Markdown.

**A save over an older head replaces the newer text.** `rebaseHeads` in the
same file puts the late save on top of the current head. The head it passed
becomes a History entry, and `announceSuperseded` in
`packages/sync/src/queue.ts` gives one notice. No text is deleted, and the
text of the other device leaves the note.

**The device sends before it reads.** One cycle of
`packages/sync/src/engine.ts` pushes the queue first and pulls the change feed
second. A device that saved offline sends before it learns that the note
moved, so no logic on the device can compare the texts in time.

**The feed falls back to a full snapshot.** `packages/sync/src/snapshot.ts`
restarts from a snapshot when a cursor or a page expires. A device that is far
behind therefore never needs the whole history of changes.

**Drafts and versions are local rows.** `packages/storage-browser` keeps a draft
for each working copy and an immutable checkpoint for each version.
`expectedHeadOfParent` in `local-store/shared.ts` names the precondition of a
save
([record 0073](../decisions/0073-a-save-names-the-revision-it-descends-from.md)).

**One editor instance holds the note.**
`apps/web/src/features/editor/note-editor.tsx` builds one CodeMirror view for
each working copy and never replaces its document. A change from another
device must reach that view as a transaction, not as a new document.

## The first question: merge or never conflict

There are three families of solution.

**Conflict copies.** Bear, Joplin and Standard Notes write the second version
as a second note. Nothing is lost, and the person merges by hand every time,
also for two edits that do not touch.

**Three-way merge.** Obsidian Sync compares the common base, the local text and
the remote text with a character diff. Its documentation says the merge can
create duplicate text or broken formatting, and it offers a conflict file as a
setting. A three-way merge needs the common base on every device, and it
answers for one pair of versions only. Three devices, or two merges in a
different order, can give two different notes.

**A conflict-free replicated data type (CRDT).** Notion, Apple Notes and Craft
keep text as a structure in which every inserted character has an identity and
every edit is an operation. Any device applies the operations of any other
device, in any order and any number of times, and every device reaches the same
text. Two edits of one place both survive.

**Decision: the text of a note is a CRDT document.** It is the only family that
gives the same note on every device for every order of arrival, with no base
text to keep and no prompt. A save carries a small delta instead of the whole
text. Live editing on two devices becomes a later feature and not a second
rewrite.

A CRDT keeps both sides of two rewrites of one sentence, so the text can read
badly. It is never lost. The Review surface below answers that case.

## The second question: which library

Three libraries have a CodeMirror binding.

**Automerge** and **Loro** are Rust cores compiled to WebAssembly. Each adds a
large module to the first load, which
[record 0044](../decisions/0044-the-worker-stays-out-of-the-first-load.md) and
the precache rules protect. The Automerge binding is built around its own
repository and network layer, which duplicates the sync engine of this product.
Loro keeps two concurrent insertions at one place apart better than the others,
and it is the youngest, with the smallest community.

**Yjs** is plain JavaScript, small, and the most used CRDT library in
JavaScript. It runs unchanged in Node, so the server applies the same code as
the browser. Its undo manager tracks only the edits of a chosen origin. It keeps
the characters of one insertion together, so two insertions at one place read
as two runs of text, one after the other.

**Decision: Yjs, on its stable major line, behind one package.** The package
`packages/note-document` is the only module that imports Yjs. It exposes a
small set of pure functions over bytes: start a document from text, apply an
update, compute the update since a state, read the text, read the state
vector, and replay text work over a new document. `packages/core` declares a
port for the server half of that set, and `apps/server` wires the package into
it, so `core` keeps no dependency. `packages/editor` joins the package to
CodeMirror through the Yjs CodeMirror binding. The next major line of Yjs is
still a release candidate. A move to it later changes this one package and the
binding, and nothing else.

## The third question: where the CRDT sits

**Option A: the CRDT replaces revisions.** The note becomes an update log and
History becomes a list of snapshots. This rewrites the contract, the commit
rules, the server tables, the browser tables, History, restore and the feed at
once, for no gain that a person sees over option B.

**Option C: the device merges before it sends.** The engine pulls first, the
device merges, and the server refuses a save over an older head. This leaves
two writers of the Markdown of a note, so a device with a defect can store
Markdown that its own document does not hold.

**Option B: the CRDT rides inside revisions.** This is the decision.

- A changeset keeps its shape. A revision of a note carries a Yjs update with
  every local operation since the last head that its device applied, and the
  state vector that the device held when it made the save. It carries no
  text and no digest. The contract carries the bytes as base64.
- The server keeps one current document for each note. It applies the update
  inside the transaction that already takes the workspace lock, reads the text
  of the result, checks it, computes its digest, and stores it as the content
  of the revision. The server is the one writer of the Markdown of a note.
- The parent of the revision is always the current head, so History stays one
  line. A save never rebases text and never supersedes a head.
- The revision records whether it joined work that its device had not seen.
  That is true when the state vector the device held does not cover the state
  of the current document. History marks such a revision as merged.
- The server also keeps the update of each revision, because the change feed
  sends it to the other devices.
- The answer of an accepted changeset names the revision, the digest of the
  result, and the state vector of the document after it.

History, search, backlinks, export, import and the published page keep reading
stored Markdown and do not change.

## The fourth question: the device

The browser store keeps, for each note it holds, the document bytes, the text
of the document, the epoch of the document (see the seventh question), and the
last head that it applied: its revision, its text and its state vector. A feed
item carries all three. The device needs the text of that head as a stored
value, because a Yjs document cannot give back the text of an earlier state.

- **Typing.** The open editor holds one Yjs document in memory, joined to the
  one CodeMirror view. A local edit changes the document, and a coalesced write
  stores the new bytes and text. The draft of today becomes this write, and it
  stays recovery data until a save.
- **Saving.** Record 0022 stays: a pause, a blur or a move away ends one save.
  The save queues one mutation with the update since the last head that the
  device applied, not since the last queued save. Every queued mutation
  therefore stands alone: the server always holds what it depends on, and a
  refused mutation never blocks the next one. Two mutations can carry the same
  operations, and a Yjs update applies once however many times it arrives, so
  the overlap and a repeated send are both safe. The queue freezes the body on
  the first send, as now. A queued save also keeps the text of the document at
  that save, so History on the device lists it before the server accepts it,
  as a checkpoint does today, and Review can read it.
- **Refusal for good.** When the server refuses a save for good, for example
  for the note size, the device keeps its document and its text, and the save
  reaches Needs attention as record 0026 states. The next save of that note
  carries every operation since the last applied head again.
- **Receiving.** The feed brings the update and the text of each accepted
  revision, and its epoch. When the epoch is newer than the one the device
  holds, the feed item carries the whole new document instead of an update,
  and the device replaces its document and replays its unsent work. Otherwise
  the store applies the update to the stored bytes. When the note is open, the
  store publishes the change, and the editor applies the updates it does not
  hold, with a remote origin. The binding turns them into one
  CodeMirror transaction, so the selection moves with the text.
- **Undo.** The Yjs undo manager replaces the CodeMirror history in the note
  editor. It tracks the local origin only, so undo never reverses the work of
  another device. The keys and the `shortcuts` list of
  `packages/editor/src/keymaps.ts` stay the same.
- **Composition.** While an input method composition is active, the editor
  holds remote updates and applies them when the composition ends.
- **Other tabs.** Each tab holds its own document and reads the updates it
  lacks from the store after the invalidation channel names the note, so the
  tabs converge the same way two devices do.
- **Check.** When a device holds no unsent work for a note and its feed has
  reached the head, the digest of its text must equal the digest of the head.
  When it does not, the device takes the full document of the server and replays
  its own work over it, as the seventh question states. This check turns a
  silent divergence into a repair.
- **The engine.** It keeps its order: push, then pull. A CRDT does not need the
  device to read first.

The precondition of record 0073 no longer applies to text, because no text save
is refused for a moved head. It stays for the path and the deletion state.

## The fifth question: conflicts that are not text

A path and a deletion state are single values. The server decides each one
with one rule, so every device reaches the answer of the server, and the device
whose intent did not win reads one notice. The rule for an edit against a
deletion gives the same answer in both orders of arrival, because it protects
text. The rule for two paths follows the order in which the server accepts
them, because neither path holds more of the work of the person.

- **A save that did not change the path.** It keeps the current path of the
  file. A save changes the path only when its path differs from the path of
  the head its device last applied, which the precondition of record 0073
  names. So a save of text never undoes a rename or a move from another
  device, as `rebasedPath` in `packages/core/src/files/commit.ts` already
  holds.
- **Two renames or moves of one note.** The one that the server accepts last
  wins. The other path stays in History. The device whose path lost reads
  "Renamed on another device" with the new name.
- **An edit against a move to Trash.** The edit wins, in both orders. A deletion
  carries the state vector its device held. When the document holds changes
  that state does not cover, the server refuses the deletion, and the device
  reads that the note stays because it changed on another device. When an edit
  arrives for a note already in Trash, the server applies it and brings the
  note back, and every device reads that the note returned from Trash. This
  replaces the recovered copy of record 0026 with the note itself.
- **Two new notes at one path.** The server accepts both. The second takes the
  next free name, in the form that the create action already uses, and its
  device reads one notice.
- **An edit against a permanent delete.** A permanent delete is final. When the
  server answers that the note is gone, the device creates a new note from its
  own text at the same path, with a new document, and reads one notice. No
  text of the person is dropped.
- **A folder move against an edit inside it.** These do not touch and both
  apply.

## The sixth question: what the person sees

A text merge needs no decision, so the product asks for none. The work of
another device appears in the open note as a change of the one editor.

A merge after work that a device did not see can still read badly, so the
person must be able to check it. The device whose accepted save joined unseen
work shows one line on that note: the note changed on another device at the
same time, with a Review action. Review compares the text of the last save this
device made before the merge with the current text, with the unified diff that
History uses. The person fixes the text in the note. The line leaves when the
person opens Review or dismisses it, and it is state of that device only.

Every device sees the merge in History, because the revision is marked as
merged there.

The product never holds a save until a person decides. A held save keeps the
work of one device on that device only, where a lost laptop loses it, and the
other devices cannot see the problem.

## The seventh question: the first state of a document

A document must start once, from one writer. Two devices that each start a
document from the same Markdown make two sets of character identities, and a
merge of the two holds the text twice. The design makes that impossible.

- The server starts the document of every existing note from its head, once, in
  a data migration beside
  `packages/storage-server/src/portable-markdown-migration.ts`. A device
  receives documents with its snapshot and feed and never starts a document from
  Markdown for a note that exists.
- A new note starts on the device that creates it, which already assigns the
  file identity. Its first save carries the first state.
- An import and a restore of a purged note start their documents on the server.

Each document has an **epoch**, a number that grows when the server starts that
document again. Two events start a document again: the migration above, and a
compaction when the bytes of a document pass the bound that
`packages/note-document` names. A compaction starts a new document from the
current text.

A save for an older epoch is refused. The device then takes the new document and
**replays** its unsent work over it. Replay compares three texts: the text of
the last head of the old epoch that the device applied, its own text, and the
text of the new document. It keeps every local insertion, at the matching place
in the new text, and applies a local deletion only to text that is still there
unchanged. So replay drops no text of the person, the same promise a CRDT makes.
The device then shows the Review line. A device that held a draft or a queued
version from before this change replays it once, the same way. Replay is the
only place that compares texts, and it lives in `packages/note-document`.

## The change of format

The contract of a save and of the feed changes in a way that an older client
cannot read. The server refuses a changeset in the old form with one code, and
the client answers that code by loading the new version of the application.
The browser store upgrades its schema on that load. Its drafts and queued
versions from before the change become unsent work that replays once, as the
seventh question states, so an update never drops a word that waited on a
device.

## The eighth question: History and restore

A revision stays an immutable state of the file with stored Markdown, so History
reads as today. A restore becomes an edit: the server turns the difference
between the current text and the chosen revision into operations on the
current document and applies them. A restore therefore merges with an edit that
another device made offline, as any edit does.

## Limits and validation

`packages/note-document` names every bound, and the server and the browser read
the same values: the bytes of one update, the bytes of one document, and the
ratio of document bytes to text bytes that starts a compaction. The limit of the
note size applies to the text of the result, as today. The server decodes an
update under those bounds and refuses a malformed update or one that names
operations it does not hold, before it writes anything. The text it stores
passes the rules of
[record 0021](../decisions/0021-portable-markdown-at-rest.md). The row access
rules do not change.

A device that stays offline for a long time sends operations against an old
state, and they still apply, unless a compaction started a new epoch, when
replay applies. No save expires.

## What the gate proves

The gate proves convergence, which it does not do today.

- `packages/note-document` has a property test: random concurrent edits on
  several documents, delivered in random orders and repeated, always reach one
  text. Replay has a unit test for each case of the seventh question.
- `tests/integration/sync.test.ts` proves two devices on a real server: a
  disjoint edit offline, an edit of one sentence on both, an edit against a
  move to Trash in both orders, two renames, two creates at one path, and an
  expired epoch.
- `tests/integration/browser-storage.test.ts` proves the document rows, the
  queue, the epoch refusal and the upgrade of a draft from before this change.
- `packages/editor` proves, with a headless state, that a remote update keeps
  the selection and that undo reverses local edits only.

## What stays out

- **Live editing on two devices at once, and the presence of other devices.**
  The CRDT allows both. They need a push channel that the contract does not
  have, so they are a later design.
- **A colour for the text of each device.** Review covers the need.
- **Attachments.** An attachment is immutable bytes with no text to merge. Its
  rules do not change.

## The cost

This is the largest change since the version 0.1 revamp. It changes the save
model, adds a package, changes the contract of a save and of the feed, changes
the server tables and the browser tables, and migrates every note. It touches
`packages/core`, `packages/sync`, `packages/storage-browser`,
`packages/storage-server`, `apps/server`, `packages/api-contract`,
`packages/editor` and `apps/web`, and the rules of the root `AGENTS.md` about
drafts and versions.

The order of the work keeps the risk low. The package and its property test come
first. The contract and the server follow, with the two-device test on a real
database. Then the browser store, the replay and the engine. The editor binding
comes last, because a person sees it and it depends on everything before it.
[Plan 013](../plans/013-conflict-free-sync-of-note-text.md) holds that order.

## Decisions

- [0076. The text of a note is a CRDT document inside its revisions](../decisions/0076-the-text-of-a-note-is-a-crdt-document.md)
- [0077. Yjs behind one package](../decisions/0077-yjs-behind-one-package.md)
- [0078. One rule for each conflict that is not text](../decisions/0078-one-rule-for-each-conflict-that-is-not-text.md)
- [0079. Review is the one surface of a merge](../decisions/0079-review-is-the-one-surface-of-a-merge.md)
- [0080. A document starts once and an epoch carries work across a new start](../decisions/0080-a-document-starts-once.md)
