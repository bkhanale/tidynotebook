# Save, delete, and trash audit

- Date: 2026-09-12
- Commit read: 75a9e80

This audit reads the save, delete, trash, restore, history, and recovery
workflow. It reports two kinds of finding. The first kind is a correctness
defect: a deleted note comes back. The second kind is a product defect: the
workflow shows the person more concepts than a simple notes app needs. Each
finding names the code by path and line. A finding is not a fix. Each finding
becomes a row in `docs/releases/`.

## How the workflow works today

Delete writes a tombstone revision. The note leaves the file tree but keeps its
identifier and its history (`packages/core/src/files/trash.ts:1-13`). Trash
lists the tombstoned files (`packages/core/src/files/trash.ts:78-100`). Restore
writes one revision on top of the tombstone
(`packages/core/src/files/trash.ts:212-244`). Delete permanently calls
`purgeFiles`, which removes the revisions for good.

On the client, the note list comes from two tables: `acceptedFiles` and
`drafts` (`packages/storage-browser/src/local-store/files.ts:66-127`). A note is
live when an accepted row has `deleted` false, or when a draft with `deleted`
false leads (`packages/storage-browser/src/local-store/shared.ts:68-77`). Every
resurrection below makes one of those two conditions true for a note that the
server holds as deleted or purged.

## Part 1. The note comes back (correctness)

Two facts set the scene, and both are read from the source, not assumed. First,
a live note can be purged. A purge is blocked only by a shared attachment
reference, so a plain note reports `canPurge` true
(`packages/storage-server/src/workspace-store/trash-repository.ts:192`). Second,
a write to a purged file is refused with the code `purged`, not `stale_head`,
and the check runs before the rebase (`packages/core/src/files/commit.ts:350-351`).
A purge and a stale head are therefore two different paths on the client, and
the note comes back on both.

### F1. A permanently deleted note comes back as a kept save (P0)

This finding matches the report the closest. The person deletes a note, opens
Trash, and selects Delete permanently. The note text comes back on the Needs
attention screen, and Save as new note there brings the whole note back live.

The cause is a race between the local deletion queue and the purge call.
Deleting the note writes a local tombstone and a queue entry, but the sync
engine has not sent the tombstone yet. Trash still lists the note as a pending
item and lets the person act on it
(`apps/web/src/features/trash/trash.tsx:97-105`,
`apps/web/src/features/trash/trash.tsx:497-522`). Delete permanently purges the
file that the server still holds as live. The next cycle sends the queued
tombstone, because `pushQueue` runs before `pullNew`
(`packages/sync/src/engine.ts:361-389`). The server refuses the tombstone with
`purged` (`packages/core/src/files/commit.ts:350-351`). `submitSingle` does not
route `purged` to the stale head recovery, so it parks the mutation as a refused
save (`packages/sync/src/queue.ts:600`). `parkRefusedSave` copies the Markdown
text of the deletion into the recovery area
(`packages/sync/src/queue.ts:255-265`). Needs attention then lists the note as a
kept save with the cause permanently deleted
(`apps/web/src/lib/parked-saves.ts:31`), and Save as new note writes the text as
a new live note. A deletion parked as a kept save is itself wrong: a deletion
carries no text to save again.

### F2. A queued deletion that a stale head refuses is un-deleted (P1)

The second path resurrects the note live and needs no purge. The person deletes
a note on one device while another device edits it, or an offline device
reorders a delete after an edit. The queued tombstone is refused with
`stale_head`, because the head moved past a deletion boundary
(`packages/core/src/files/commit.ts:186-203`). `submitSingle` routes this to
`recoverStaleHead`, which classifies the deletion tip and calls
`discardQueueEntry` (`packages/sync/src/queue.ts:346-355`).
`discardQueueEntry` then flips the accepted row back to live. It writes
`deleted: wasDeletion ? false : file.deleted`
(`packages/storage-browser/src/local-store/queue.ts:183`). The note reappears in
the note list. The intent is to keep a note that another device changed, but the
same line runs for every stale deletion, and it never removes the leftover
deleted draft.

### F3. A purge does not forget the whole local trace of a note (P1)

`forgetFile` is the one handler for a purge marker, which arrives as a change
with no file and a purged file id
(`packages/storage-browser/src/local-store/snapshot.ts:413-421`). It deletes
only the accepted row and the drafts
(`packages/storage-browser/src/local-store/snapshot.ts:127-151`). It does not
delete the queue entries, the checkpoints, the contents, or the recovery rows of
the file. The parked kept save of F1 is one result of this: the recovery row
outlives the note. The surviving content also lets a resurrected note still open
with its old text.

### F4. A fresh snapshot never forgets a purged note (P0)

A purge reaches the client through one channel only: the incremental change feed
and its purge marker. A fresh snapshot does not use that channel.
`activateSnapshot` walks the files that the snapshot contains, and it only ever
writes an accepted row for one of them
(`packages/storage-browser/src/local-store/snapshot.ts:283-349`). It never
deletes a local accepted row or a draft for a file that the snapshot leaves out.
The client takes a fresh snapshot when the cursor is null or the cursor expires.
A 410 for an expired cursor sets the cursor to null and takes a full snapshot
(`packages/sync/src/snapshot.ts:121-160`,
`packages/sync/src/snapshot.ts:267-268`). So the sequence delete, purge, cursor
expires before the purge marker is read, full snapshot, keeps the purged note on
the device for good. The note returns to Trash, and any wrong state that F2 left
becomes permanent.

### F5. A tombstone draft is never cleaned up (P1)

After the server accepts a tombstone, `acknowledge` advances the accepted head
but never touches the drafts table
(`packages/storage-browser/src/local-store/queue.ts:249-392`). The deleted draft
stays. `readCachedNote` never drops a deleted draft, because `dropStaleDraft`
runs only when the draft is not deleted
(`packages/storage-browser/src/local-store/drafts.ts:324-338`). Only a purge or
a restore removes it, and a restore that arrives during local work takes the
dirty branch and leaves it as well
(`packages/storage-browser/src/local-store/snapshot.ts:511-517`), against the
comment above that path
(`packages/storage-browser/src/local-store/snapshot.ts:490-493`). The leftover
draft is the shared fuel of Part 1. It stays hidden only while
`localHeadRevisionId` equals `acceptedHeadRevisionId`, a fragile invariant
(`packages/storage-browser/src/local-store/shared.ts:73-77`).

### Where the correctness root cause sits

The root cause is in the local reconciliation layer, across two packages. The
durable state mutators in `packages/storage-browser/src/local-store` do not hold
one invariant: a purged note has no local trace. `forgetFile` is partial,
`activateSnapshot` omits deletions, `acknowledge` and `discardQueueEntry` leave
drafts, and `discardQueueEntry` resets the deletion flag. The orchestration in
`packages/sync` parks a refused deletion as a kept save, which puts the text of
a permanently deleted note in front of the person again. The user interface
layer is close to correct. The editor routes the open note through
`deleteOpenNote` so autosave cannot re-save it
(`apps/web/src/features/editor/note-editor.tsx:610-634`).

## Part 2. The workflow shows too many concepts (product)

The app has five destinations for one save and delete story: the note editor,
Trash, History, Needs attention, and Settings offline
(`apps/web/src/router.tsx:78-98`). A simple notes app needs fewer.

### F6. Save reports four states, and two are sync internals (P1)

The Save button shows `Save`, `Saving`, `Saved on this device`, and `Saved`
(`apps/web/src/lib/save-state.ts:75-80`, `apps/web/src/features/editor/note-header.tsx:157-173`).
The split between saved on this device and saved asks the person to care whether
the server acknowledged the save. The internal model holds six states
(`apps/web/src/lib/save-state.ts:11-17`). A simple notes app shows at most saved
and saving.

### F7. The save state is reported in three places at once (P1)

The Save button, the note footer, and the sidebar each report the save state.
The footer shows the last saved time or no saved version yet
(`apps/web/src/features/editor/note-footer.tsx:32-41`). The sidebar shows a
server sentence (`apps/web/src/shell/shell.tsx:687-692`,
`apps/web/src/lib/sync-state.ts:70-91`). The three can disagree. Decision 0017
placed the state on the Save button, so the footer and the sidebar are the
surplus.

### F8. Delete has three interaction patterns for one action (P1)

The sidebar deletes with no confirmation and an undo toast
(`apps/web/src/shell/shell.tsx:459-523`). The editor header deletes with an
inline confirm and an undo toast
(`apps/web/src/features/editor/note-header.tsx:139-152`). Trash deletes
permanently with an inline confirm (`apps/web/src/features/trash/trash.tsx:583-615`).
The person cannot predict whether Delete asks first.

### F9. One operation and one concept carry two words each (P1)

Undo and Restore are the same operation. Both call `restoreNote`
(`apps/web/src/features/trash/trash.tsx:296-327`,
`apps/web/src/features/trash/trash.tsx:476-495`). Delete permanently and deleted
for good are the same concept, and both appear on the Trash screen
(`apps/web/src/features/trash/trash.tsx:517`,
`apps/web/src/features/trash/trash.tsx:614`). Delete and Delete note name the
same action on two rows (`apps/web/src/features/editor/note-header.tsx:109`,
`apps/web/src/shell/shell.tsx:188`). These break the one term per concept rule.

### F10. Needs attention is a second inbox for refused saves (P1)

Needs attention is a whole second workflow. It holds kept saves with its own
verbs: Retry, Save as new note, Copy text, and Discard
(`apps/web/src/features/attention/attention.tsx:63-159`). It exists only because
the server can refuse a save. It gives the person a second place, after Trash,
to put work back, with different words. A recovered copy carries a recovered
name suffix (`apps/web/src/lib/parked-saves.ts:17`,
`apps/web/src/lib/parked-saves.ts:128-138`).

### F11. The note route has five error screens (P2)

One note route branches into five states: not found, deleted permanently,
deleted on this device, unavailable, and local storage unavailable
(`apps/web/src/features/editor/note-editor.tsx:1344-1420`). The copy narrates
the sync queue, for example that the deletion goes to the server when the device
has a connection.

### F12. The editor shows multi device conflict resolution (P2)

The stale draft bar asks the person to keep their text or use the latest version
(`apps/web/src/features/editor/note-editor.tsx:1043-1064`). This is conflict
resolution inside the editor of a simple notes app.

### F13. Several surfaces narrate the sync queue and the device (P2)

Trash shows waiting to go up (`apps/web/src/features/trash/trash.tsx:555-571`).
The sidebar shows a per note Local chip
(`apps/web/src/shell/shell.tsx:165-172`). Settings shows offline cache controls
(`apps/web/src/features/accounts/accounts.tsx:639-667`). Sign out reports that
some saves have not reached the server
(`apps/web/src/features/accounts/accounts.tsx:709-733`). Each one shows the
person the sync internals.

### Copy rule findings

- An error kind reaches the person. The failure text appends the raw
  `LocalStorageErrorKind` inside the message
  (`apps/web/src/features/attention/attention.tsx:194-197`). The copy rule
  refuses an error code in user text.
- The word Keep names four different actions: cancel a delete, cancel a discard,
  and keep a note offline
  (`apps/web/src/features/editor/note-header.tsx:149`,
  `apps/web/src/features/trash/trash.tsx:598-602`,
  `apps/web/src/features/attention/attention.tsx:135-142`,
  `apps/web/src/features/accounts/accounts.tsx:654`).
- A refused save is narrated twice: once in the sidebar sentence and once on the
  Needs attention screen (`apps/web/src/lib/sync-state.ts:80-81`,
  `apps/web/src/lib/parked-saves.ts:21-45`). The copy rule asks for one message
  for one cause.

## Priority summary

| Id  | Finding                                                | Kind        | Impact |
| --- | ------------------------------------------------------ | ----------- | ------ |
| F1  | A permanently deleted note comes back as a kept save   | Correctness | P0     |
| F2  | A stale head refusal un-deletes a queued deletion      | Correctness | P1     |
| F3  | A purge does not forget the whole local trace          | Correctness | P1     |
| F4  | A fresh snapshot never forgets a purged note           | Correctness | P0     |
| F5  | A tombstone draft is never cleaned up                  | Correctness | P1     |
| F6  | Save reports four states, two are sync internals       | Product     | P1     |
| F7  | The save state is reported in three places             | Product     | P1     |
| F8  | Delete has three interaction patterns                  | Product     | P1     |
| F9  | One operation and one concept carry two words each     | Product     | P1     |
| F10 | Needs attention is a second inbox for refused saves    | Product     | P1     |
| F11 | The note route has five error screens                  | Product     | P2     |
| F12 | The editor shows conflict resolution                   | Product     | P2     |
| F13 | Several surfaces narrate the sync queue and the device | Product     | P2     |
