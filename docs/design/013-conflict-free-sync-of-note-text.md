# 013: Conflict-free sync of note text

Status: active

This design states how devices that edit one note reach one accepted document
without a silent whole-text overwrite. It answers
[issue 152](https://github.com/bkhanale/notesapp/issues/152). The review replaces
records 0076 to 0080 with the records in the Decisions section. Those older
records remain as decision history. This is the target design, not a claim that
the new engine is present in the code.

## The problem and the current code

A person writes on a laptop without a connection. The same note changes on a
phone. When the laptop reconnects, both accepted edits must reach the live note.
The current server keeps one text in the note and the other in History.

`packages/core/src/files/commit.ts` rebases a whole-text save onto the current
head. `packages/sync/src/engine.ts` pushes before it pulls, so the device can
send that text before it sees the other edit. Record 0073 prevents a clean
working copy from posing as new work, but it does not merge concurrent edits.

The server already has useful boundaries. One changeset owns an atomic write.
The workspace lock orders writes, and immutable Markdown revisions supply
History, search, export, and published reads. The browser queue keeps stable
mutation identities. A full snapshot replaces an expired feed cursor.

There are also boundaries that the change must repair. The acceptance path in
`packages/storage-server/src/workspace-store/portable-links.ts` rewrites note
links after a move. It is a text writer, not only a reader of Markdown. The
browser invalidation channel announces a change but does not persist it. A
receipt can confirm text that the sender has not received. A purge feed record
can remove local work through
`packages/storage-browser/src/local-store/snapshot.ts`.

## The approach and its limits

Conflict copies keep work but ask the person to join it. A three-way text merge
can join many separate edits, but repeated passages and overlapping replacements
can make placement ambiguous. Operational Transformation is another established
approach; [ShareDB](https://github.com/share/sharedb) supports it, including
offline changes. A CRDT is therefore a choice for this product, not the only
industry approach or a formal standard for the whole sync protocol.

The choice is a Yjs text document inside the existing revisions. Yjs fits the
browser and server runtimes and the CodeMirror editor. Its
[document updates](https://docs.yjs.dev/api/document-updates) support duplicate
and reordered delivery. The product keeps its current transport and storage
ports rather than adopting another repository or network layer.

The guarantee has a boundary: devices with the same document identities and
complete accepted updates reach the same text. The service must still validate
updates, preserve refused work, and deliver dependencies. Convergence does not
prove that a sentence reads well. Review remains necessary. A migration from
whole text has weaker information and uses a separate recovery rule.

The alternative of replacing revisions with an update log changes every History
reader and restore path. Keeping revisions preserves those readers. The cost is
that document state and derived Markdown must commit together. A client-side
merge followed by a whole-text server write would keep two authorities for text,
so it is excluded.

## Observed state and the accepted write

A Yjs state vector tracks inserted structures. It does not track deletions.
The [Yjs deletion model](https://github.com/yjs/yjs/blob/v13.6.27/INTERNALS.md)
keeps a deletion set separately. Equal vectors therefore do not prove equal
text or complete knowledge of another device's work.

A save carries its update, epoch, and complete observed state. Observed state
contains the vector and deletion set of the document the device holds at the
save. The vector remains useful for computing a delta. Complete state, within
one note and epoch, decides whether the save joins unseen accepted text work.
It also decides whether Trash would hide an unseen edit. A metadata-only head
change does not by itself make a text merge.

The domain keeps a document service port. The server supplies the Yjs adapter.
After authorization and receipt lookup, the service applies the update to a
trial document, checks its structure and dependencies, and validates the text.
Only then does it derive Markdown and its digest for the revision. The revision
follows the current head; text never rebases by whole-text replacement.

A successful library apply call is not sufficient validation. Yjs can hold work
whose dependencies have not arrived. The service must refuse unresolved
insertion and deletion dependencies before acceptance. It also limits decoded
work and permits only the supported text structure, not arbitrary shared roots,
formatting, or embedded values.

Every text writer follows this path. That includes direct note operations,
imports, History and Trash restore, and link rewrites after a note, attachment,
or folder move. A restore edits the current document. A move can add operations
for several source notes. Indexes consume the resulting Markdown and do not
write another form of it.

Document state, Markdown, revisions, updates, indexes, cursor, and receipt share
one accept savepoint. The existing transaction wrapper commits returned results,
including expected refusals, so placing a document write in the outer transaction
alone does not make a refused save atomic. Record 0081 owns this boundary.

## The package and the live editor

`packages/note-document` owns Yjs on its stable major line. Its shared API works
on bytes and has no browser or Node dependency. Core imports no package; the
server composition root supplies the implementation of its port.

The editor needs a live document, so a bytes-only API is insufficient. The
package also owns an opaque session with explicit lifetime and subscriptions.
A private editor bridge exposes live Yjs text and undo types only to
`packages/editor`. Core, sync, storage, and web feature APIs keep no Yjs types.
The shared package entry does not load CodeMirror. The boundary checker holds
this narrow exception, and the lockfile selects a tested library and binding
pair. Record 0082 states the ownership rules.

One open working copy keeps one session and one CodeMirror view. Local edits
enter that document. Remote operations enter with a separate origin, so they
neither enter local undo nor schedule another local save. While composition is
active, remote updates wait before they reach the bound document. Delaying only
a view notification would be too late for a binding that already observes it.

Undo and redo retain their keys. Plain History and diff editors remain valid.
Closing a note releases subscriptions and the undo manager. An explicit repair
preserves local work before it invalidates old undo references. Theme and preview
changes never replace the document.

## Durable local work and acknowledgments

The browser distinguishes the last fully applied server state, the live
document, unsaved work, frozen queued checkpoints, and mutation receipts. These
are different facts even when their text happens to match.

A tab writes updates by reading and merging the latest durable document inside
one IndexedDB transaction. It never overwrites that row with a stale whole
buffer. Invalidation follows commit. A tab that resumes reads missing durable
work even if it received no message. The one sender lease does not serialize
all editor writes.

Save boundaries remain those of record 0022. Each queued save freezes its text
and complete observed state, with the cumulative update since the last fully
applied server head. This keeps the update independent of a refused predecessor.
Another tab's later edits cannot change that checkpoint. The first send freezes
the exact request body and digest, including the membership of a batch.

A receipt proves acceptance, not that the device has applied unseen remote
content. The device advances its applied state only with matching document
content from a coherent response or feed. An older receipt cannot move a newer
head backwards or remove a later draft. Local History keeps the frozen pending
text; accepted History reads the server's revision.

A feed transaction commits document state, head metadata, and cursor together.
A full snapshot captures matching document bytes and a cursor, and its activation
keeps unsent work. A real epoch boundary emits a full-document record. The server
cannot decide what is a newer epoch for each device from a global cursor alone.
An expired cursor restarts from a full snapshot.

A digest check compares settled local text with the exact applied head. It is a
useful repair trigger, but matching text alone does not prove equal CRDT state.
Repairs preserve original local work before any replacement. Record 0085 owns
local persistence and receipt rules.

## Paths, Trash, and permanent deletion

A text save that has no path intent keeps the accepted path. A rename uses the
base rule of record 0073. The last accepted rename of one note wins and remains
in History. A rename or folder move into another live file fails atomically.
A create or recovery instead takes the next free name through one shared rule.

An edit wins over concurrent Trash in either order. Complete observed state
prevents Trash from hiding an unseen insertion or deletion. New text work for a
trashed note applies and restores it. A duplicate update already included when
Trash was accepted does not restore it. A metadata-only change is not new text
work. The tombstone retains the document needed for Restore.

A permanent deletion ends that file identity. Unsent local work becomes a normal
synced note with a new stable identity and a free path. Recovery applies to a
failed push, an explicit purge feed record, and confirmed absence from a complete
snapshot. It preserves even a draft that has no queued save. A partial page is
not proof of deletion. One refused batch cannot discard work on its other files.
Record 0083 owns these rules and their notices.

## Initialization, compaction, and recovery

An existing note starts once on the server. The migration is restartable and
preserves the last live text of a trashed note. A new offline note starts on its
creating device. Import starts on the server. No device starts a second document
from Markdown for an existing note.

Routine compaction merges stored updates and uses supported garbage collection.
It keeps character identities and the epoch, so older offline updates remain
valid. This costs storage: compaction cannot promise that a document always fits
one fixed size. The implementation measures growth and sets resource bounds.

Rebuilding a document from current text discards identities. It would make every
old update depend on a text-recovery algorithm, including normal offline work.
That is not routine compaction. No automatic destructive reset ships in this
change. A later reset needs a separate decision and a proven protocol. The epoch
remains a guard for migration and explicit repair boundaries.

Legacy drafts and queued saves still need a bounded conversion. Before it
converts uncertain work, the device resolves the original mutation identity and
request digest. Work that the server already accepted is not inserted again.
Migration persists its progress, source checkpoint order, and stable replacement
identities together. It does not drop original work until the replacement is
durable. It does not normalize line endings or Unicode.

Three text values cannot always identify where a repeated passage belongs or
whether an identical insertion is already accepted work. Recovery reports that
ambiguity. The automatic safe result is a normal synced recovery note with a
stable identity, plus Review. It is an exception for migration or repair, not
the rule for concurrent Yjs editing.

If document or update bounds prevent normal sync, keep the work and offer bounded
recovery to a new note, or export when it cannot sync. A smaller visible text does
not necessarily make a cumulative delta smaller. The queue must not retry the
same oversized bytes forever or block unrelated notes. Same-epoch repair first
tries compatible pending operations against the full server document; it uses
text recovery only when identities or dependencies cannot be trusted. Record
0084 owns these boundaries.

## Review and History

Normal merges never wait for a person. The device whose save joins unseen work
retains the exact local checkpoint that caused the merge. Review compares it
with the current text through the unified diff. A later draft cannot replace
that comparison base.

Review state persists for the device and the event. Opening or dismissing one
event does not suppress a later merge. Migration and repair also offer Review,
with one action to reach preserved work when recovery creates a note. History
marks an accepted merged revision on every device. Record 0087 replaces the
older rule that selected a mutable latest save.

## Deployment and rollback

An old client cannot learn a new error handler from a new server. A compatibility
release must precede the format change. It checks protocol capability before
push or pull. An absent capability operation identifies a legacy server; it does
not grant permission to send the new format.

The compatibility client persists working text, coordinates tabs, then activates
the waiting service worker and reloads. Failure keeps the current work available.
Clients older than that release still need readable legacy responses or a tested
stop response their existing code handles safely. Detect legacy requests before
new-schema validation. A new error code alone is not an upgrade strategy.

A receipt lookup remains actor-bound and reveals no text to a write-only caller.
A negative lookup is definitive only after the server excludes a late legacy
acceptance of that request. Drain incompatible writers before migration and
receipt-based conversion. A timeout never proves that a request failed.

Back up before migration. Rehearse migration and recovery on a disposable copy.
A rollback must stop incompatible writers. Never run old whole-text writes beside
live CRDT rows. Preserve new work before restoring a backup, or keep writes
stopped while a forward repair makes that work accessible.

Record 0086 requires the compatibility release first, then the unused document
package, then one landing of the contract, server, browser store, editor, and
note screen. Each boundary change updates its guide in the same commit.
[Plan 013](../plans/013-conflict-free-sync-of-note-text.md) maps this order to the
existing issues. Documentation completion alone does not complete the release.

## Verification and cost

The gate must prove the application protocol as well as the library. Seeded
properties cover several replicas, deletes, Unicode, reordered and repeated
updates, and old updates after compaction. Validation tests cover missing
insertion and deletion dependencies, malformed bytes, unsupported structure,
resource bounds, and refusal without partial state.

Real server tests cover deletion-only edits against Trash in both orders,
restore with offline work, move rewrites, path collisions, and access boundaries.
Browser storage tests use independent connections and failures at durable
boundaries: local writes, send, acceptance, receipt, feed, and migration. They
cover expired cursors, snapshots with pending work, and a purge with only a draft.

Editor state tests prove pure selection and undo rules. Under record 0066,
manual served-browser checks prove actual composition, worker activation, reload,
and tab lifecycle. Light and dark screenshots cover the changed surfaces. They
do not replace behavior checks. The implementation issues record results and
resource measurements rather than copying them into this design.

The scope remains large. The contract, server and browser storage, editor, and
upgrade path all change. Preserving the current History readers limits that
cost. Preserving identities avoids making a custom text merger the normal sync
path. A separate compatibility release and explicit recovery evidence add work,
but make the deployment boundary reviewable.

Live presence, a push channel, per-device text colors, and an automatic
destructive reset remain outside this change. Attachments remain immutable bytes;
only document operations for rewritten links join the sync work.

## Decisions

- [0081. Accepted text and observed state belong to one document](../decisions/0081-accepted-text-and-observed-state-belong-to-one-document.md)
- [0082. Yjs has a byte API and a private editor bridge](../decisions/0082-yjs-has-a-byte-api-and-a-private-editor-bridge.md)
- [0083. Metadata conflicts preserve unseen text work](../decisions/0083-metadata-conflicts-preserve-unseen-text-work.md)
- [0084. Compaction keeps identities and recovery keeps original work](../decisions/0084-compaction-keeps-identities-and-recovery-keeps-original-work.md)
- [0085. Local document writes merge and receipts do not advance reads](../decisions/0085-local-document-writes-merge-and-receipts-do-not-advance-reads.md)
- [0086. Protocol upgrades precede the breaking sync format](../decisions/0086-protocol-upgrades-precede-the-breaking-sync-format.md)
- [0087. Review keeps the checkpoint that caused it](../decisions/0087-review-keeps-the-checkpoint-that-caused-it.md)
