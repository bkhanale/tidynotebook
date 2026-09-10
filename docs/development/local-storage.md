# Local drafts and explicit saves

The browser stores working text before it sends data. This protects current
work during a lost connection or a page reload. Local browser data is a
working copy, not a backup. The server holds the durable version history.

## Data flow

```text
Editor input
  -> coalesced IndexedDB draft write
User selects Save
  -> immutable local version
  -> durable queue entry
Sync engine
  -> server version history
```

Editor input starts a draft write after about 120 ms. It does not create a
version. Save first finishes the current draft write. It then creates one
immutable version and wakes the sync engine. An unchanged manual Save also
creates a version.

There are no idle, interval, or page-leave version timers.

## Main files

| File                                          | Responsibility                       |
| --------------------------------------------- | ------------------------------------ |
| `packages/sync/src/local-port.ts`             | Local record shapes and storage port |
| `packages/sync/src/checkpoints.ts`            | Explicit version suppression rule    |
| `packages/storage-browser/src/database.ts`    | Dexie schema and row shapes          |
| `packages/storage-browser/src/migrations.ts`  | Validation and schema migration      |
| `packages/storage-browser/src/local-store.ts` | IndexedDB transactions               |
| `packages/sync/src/engine.ts`                 | Queue push and server pull           |

## Draft transaction

A draft write changes one mutable working-copy row. Each write has a sequence
number. Storage ignores an older sequence, so a late transaction cannot
replace newer text.

The editor shows no message for a routine local write. It reports its state
as `data-save-state` on the note element, from
`apps/web/src/features/save-state.ts`:

| Value          | Meaning                                         |
| -------------- | ----------------------------------------------- |
| `saving-local` | A draft write is in progress                    |
| `saved-local`  | The draft is on the device and not yet accepted |
| `syncing`      | A queued save is on its way to the server       |
| `saved-server` | The server accepted the local head              |
| `storage-full` | The browser has no space for the write          |
| `save-failed`  | The write or the save failed                    |

Only `storage-full` and `save-failed` show text on screen.

A draft that was written over an accepted head that the server has since moved
is returned as stale, together with the current accepted head text. The note
screen states that and lets the person choose. Taking the latest version
copies the older draft into the recovery area with the reason `stale_draft`
before it rebases the draft, so no text is lost.

## Save transaction

Save writes these records in one IndexedDB transaction:

1. Content addressed by its digest.
2. An immutable local revision.
3. The new local file head.
4. A queue entry with a stable mutation identifier.
5. The draft link to the saved revision.

The complete transaction succeeds or fails. A queue entry cannot refer to
missing content.

Save uses the working copy's last version as its parent. Two open tabs can
still send versions based on the same accepted head. The server places the
later accepted save after its current head. This keeps all explicit saves in
one linear history without a conflict workflow.

## Queue and acknowledgment

The queue sends versions in local order. A request body and digest freeze on
the first send, so a retry repeats the same mutation. Network failures use a
bounded retry delay. A later sync cycle can try again.

An acknowledgment removes the matching queue item, marks its revision as
accepted, advances the accepted head, and stores the receipt. A newer draft or
queued Save is not removed.

A permanent failure stays on the device as failed work. The save is parked in
the recovery area and listed on the Needs attention screen, which the save
state chip links to. The editor keeps the current text available for copy and
retry.

## Offline behavior

Draft writes and Save transactions do not need a connection. The foreground
sync engine wakes when a queue transaction commits and also uses a periodic
safety check. A lease prevents two tabs from sending the same browser queue at
the same time.

Snapshot activation changes only accepted server state. It does not delete
drafts or queued versions.

## Storage failures

All local methods report a `LocalStorageError` kind:

| Kind          | Meaning                                 |
| ------------- | --------------------------------------- |
| `aborted`     | The transaction did not commit          |
| `quota`       | The browser has no space for the write  |
| `unavailable` | IndexedDB is closed, blocked, or absent |
| `corrupt`     | Stored data does not match its schema   |

The editor keeps its in-memory text after every storage failure. It does not
reload the page or replace the buffer with server content.

## Compatibility data

The local database has no branch or conflict store. Schema version 4 deletes
the `branches` table of the removed conflict-branch feature and drops the
branch members of a queue entry. A queued mutation that the server refuses
for good keeps the state `conflict` and the reason of the refusal, which is
the only meaning that word still has.

Some PostgreSQL tables of the removed multi-user features stay in the
database. They are compatibility only, and the next migration removes them.
No application route creates or reads a row in them.
