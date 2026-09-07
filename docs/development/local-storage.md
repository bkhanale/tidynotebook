# Local drafts, checkpoints, and the sync queue

The browser saves work before it sends it. `packages/sync` owns the local
persistence port and the pure timing rules; `packages/storage-browser`
implements the port with IndexedDB through Dexie. The web application composes
the two, and nothing else opens a browser database.

Read `docs/design/001-initial-design.md`, sections "Offline data flow" and
"Failure behavior", for the rules this document implements.

Local browser data is not a backup. It is the working copy of one device, and
the server keeps the durable history.

## Packages and files

| File                                          | Responsibility                                                 |
| --------------------------------------------- | -------------------------------------------------------------- |
| `packages/sync/src/local-port.ts`             | Record shapes, the `LocalStore` port, and `LocalStorageError`. |
| `packages/sync/src/checkpoints.ts`            | The checkpoint scheduler and the suppression rule. Pure.       |
| `packages/storage-browser/src/database.ts`    | The Dexie schema, the row shapes, and failure classification.  |
| `packages/storage-browser/src/migrations.ts`  | Record validation, migration steps, and the interrupted guard. |
| `packages/storage-browser/src/local-store.ts` | The transactions that implement the port.                      |

## Tables and partitioning

Every private table is partitioned by three values: the **server origin**, the
**account**, and the **workspace**. Every primary key starts with those three
parts, so a range query over one partition cannot reach a row of another. One
browser profile can hold several accounts of several installations, and the
design requires that they stay apart.

| Table             | Primary key                                | What it holds                                          |
| ----------------- | ------------------------------------------ | ------------------------------------------------------ |
| `drafts`          | origin, account, workspace, working copy   | The working text of one open editor. Mutable.          |
| `checkpoints`     | origin, account, workspace, revision       | One locally created revision. Immutable.               |
| `contents`        | origin, account, workspace, digest         | Immutable Markdown text or attachment bytes.           |
| `acceptedFiles`   | origin, account, workspace, file           | What this device knows about one file.                 |
| `branches`        | origin, account, workspace, branch         | A divergent local tip and its base.                    |
| `queue`           | origin, account, workspace, mutation       | One mutation that waits for the server.                |
| `receipts`        | origin, account, workspace, mutation       | The stored outcome of one acknowledgment.              |
| `stagedSnapshots` | origin, account, workspace, token          | A downloaded snapshot before activation. Task 11.      |
| `cursors`         | origin, account, workspace                 | The commit ordered position this device consumed.      |
| `preferences`     | origin, account, workspace, name           | One stored setting.                                    |
| `recovery`        | origin, account, workspace, recovery entry | Pending work the server can no longer accept. Task 17. |
| `meta`            | `'database'`                               | Schema version, migration state, and the device id.    |

`meta` is the only table that is not partitioned. It describes the database
itself and holds no note content.

A setting that belongs to the account rather than to one workspace uses the
reserved workspace identifier `accountWide`, which is the empty string. An
IndexedDB key cannot be `null`, so the partition keeps three parts and this
value fills the third. It is not a valid UUID, so it cannot collide with a real
workspace.

`acceptedFiles` holds two heads. `acceptedHeadRevisionId` is what the server
last confirmed, and it is the value a submission puts in `expectedHeads`.
`localHeadRevisionId` is the newest checkpoint this device created. The local
head stays ahead while work is pending and never moves backwards.

## Transaction boundaries

**A draft save is one transaction over one table.** The design's target is at
most 150 ms after input, so the editor can show Saved on this device. A save
whose `sequence` is lower than the stored one is ignored, because a late write
must not undo a newer one.

**A checkpoint is one transaction.** It writes, in this order:

```text
read the working copy and the file record
compare the content, the path, and the deletion state
  unchanged and no message -> return null, write nothing
write the content, addressed by its digest
add the immutable checkpoint with its parent
move or keep the local head, and record a branch when it diverged
add the queue entry with a fresh mutation id and its changeset
update the working copy's last checkpoint
```

Either all of that exists or none of it does, so a queued mutation always has
the bytes it refers to and a stored checkpoint always has a parent. The content
digest is computed **before** the transaction opens: WebCrypto is not a
database promise, so awaiting it inside a Dexie transaction would leave the
transaction zone.

**An acknowledgment is one transaction.** It removes exactly the acknowledged
mutation's queue entry, marks that mutation's checkpoints accepted, moves the
accepted head of each affected file to the acknowledged revision, and stores
the receipt. It changes nothing else, so a draft and a checkpoint created after
the submission survive. Acknowledging one mutation twice does nothing: the
queue entry is already gone, and the method returns without a write.

`checkpoint` uses `add` and not `put` for a checkpoint. A checkpoint is
immutable, so writing over an existing identifier is a defect rather than an
update. `accepted` is the one field that changes, and only an acknowledgment
changes it.

## Working copies and local branches

Each open editor of one file gets its own working copy identifier, and drafts
are keyed by it. Two tabs on one file therefore never write to one draft
record.

The parent of a new checkpoint is the working copy's own last checkpoint, or
the accepted revision the editor started from when it has none. Inside the
transaction the store compares that parent with the file's local head:

- equal, or no local head: the checkpoint continues the chain and becomes the
  new local head.
- different: another working copy already advanced the head, so this checkpoint
  is a second tip over the same base. The store writes a `branches` row with
  the base and both tips, and the local head does not move.

There is no automatic merge and no last write wins. Both tips stay until the
conflict screen resolves them with an inline diff.

## Committed change events and save state

The local store publishes a `LocalChange` only after its IndexedDB transaction
commits. The event contains the account, workspace, optional file identifier,
and an invalidation kind. It never contains note text, a path, or attachment
bytes. Listeners in the same page receive the event directly. Other tabs use a
`BroadcastChannel` when the browser provides it. A focus listener and a
30-second query refresh are safety nets when cross-tab messages are not
available.

`listLocalFiles` merges accepted file metadata with the newest local draft.
This makes a local create, rename, or delete visible in navigation before a
server round trip. `readFileSaveSnapshot` reports one file only. It includes
the newest draft sequence, mutation and queue state, conflict identity, and
accepted and local heads. The editor derives its status from this snapshot, so
activity for another file cannot make the open note appear saved.

Queue commits wake the foreground sync engine immediately. The 15-second poll
remains a recovery check, not the normal save path. Several wake requests
coalesce into one pass, and one engine never runs concurrent passes.

## Conflict cleanup

A stale head stores stable branch mutation and conflict group identifiers
before its first submission. A retry sends the same identity and body. After
the server accepts a resolution, `resolveConflict` applies the accepted heads,
acknowledges related checkpoints, removes related queue rows, and marks every
matching local branch resolved in one transaction. Local conflict state is not
removed before server acceptance.

## Checkpoint timing

`createCheckpointScheduler` decides when to ask for a checkpoint:

| Moment                               | Reason     |
| ------------------------------------ | ---------- |
| 750 ms without input                 | `idle`     |
| every 30 s during continuous editing | `interval` |
| the user invokes Save                | `save`     |
| the user leaves the file             | `leave`    |

The idle timer restarts on every input. The interval timer measures from the
first input of a run and is not restarted, so continuous typing cannot postpone
it. A browser throttles timers in a background tab, so the scheduler also
compares the injected clock: continuous input after a 30 s gap decides at once
even when no timer fired.

The scheduler decides only when to ask. `shouldCheckpoint` decides whether a
checkpoint is written, and the store calls it inside the transaction with the
last stored state. It suppresses a checkpoint whose content, path, and deletion
state are unchanged, unless a message was given. A named checkpoint of
unchanged content is a valid mark in history and is never suppressed.

A working copy that has not checkpointed yet is compared with the accepted head
it started from, so opening a file and leaving it writes nothing.

## Schema versions and the migration guard

`schemaVersions` in `database.ts` declares each released schema, and
`migrationSteps` in `migrations.ts` declares the record change between two
versions. A later task appends both together; a released entry is never edited,
because a released browser already ran it.

The `meta` row records `schemaVersion` and `migrationState`. Opening the
database does this:

```text
no meta row      -> write the current version, complete, and a new device id
version > current -> refuse with `corrupt`
complete and current -> use the database
otherwise:
  write migrationState 'in-progress'      (its own transaction)
  run the record migration                (one transaction over every table)
  write migrationState 'complete'         (its own transaction)
```

The three writes are separate transactions on purpose. Marking the migration as
running has to be durable before the records change, otherwise a stop in the
middle would leave a database that claims to be complete. The record migration
itself is one transaction, so it either applies fully or not at all.

A rerun at the current version revalidates every record, because an interrupted
change may have written one record and stopped before the next. A record that
fails validation, or a stored version with no migration step, refuses the
database with a `corrupt` failure. The application then shows a storage error
and read-only server content. It never silently continues.

Every read of a stored record runs its validator, which narrows `unknown`:
`validateDraft`, `validateCheckpoint`, `validateQueueRow`, and the rest.

## Failure kinds

Every method rejects with a `LocalStorageError`, never with a raw browser
error. The message names the operation and carries no note text or path, so it
is safe to log. The original error travels as the cause.

| Kind          | Meaning                                               | What the caller does                              |
| ------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `aborted`     | The transaction did not commit. Nothing was written.  | Keep the buffer, show Save failed, retry later.   |
| `quota`       | The browser refused the write for lack of space.      | Keep the buffer and show Storage full.            |
| `unavailable` | The database is closed, blocked, or absent.           | Stop claiming persistence; read-only server view. |
| `corrupt`     | A record or the stored schema version cannot be read. | Refuse the database and show a storage error.     |

The design forbids discarding the in-memory buffer and forbids reloading the
page after a storage failure. Task 14 keeps the text visible and permits
selection and clipboard copying.

## Extension points for later tasks

- Snapshot staging stays separate from active local data until activation.
- Revoked access, a downgrade to viewer, and sign-out put pending work in the
  account-bound recovery area.
- Conflict resolution reads and clears durable branch state through the local
  store transaction described above.

## Tests

`packages/sync/src/checkpoints.test.ts` covers the timing rules with a fake
clock and a fake timer queue.

`tests/integration/browser-storage.test.ts` runs Dexie against
`fake-indexeddb`, injected through the Dexie constructor options. It covers a
failed transaction that writes nothing, a full profile, two working copies that
produce a branch, an interrupted migration, a database this application cannot
read, duplicate acknowledgment, suppression, acknowledgment with later local
work, partition isolation, and a measured draft save.

The Playwright gate also checks create, save, reload, rename, delete, offline
reload, reconnect, and conflict resolution against real browser IndexedDB.
Eviction, private mode limits, and physical-device quota behavior still differ
by browser and device.
