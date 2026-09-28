# 0127. A sync page holds whole commits

- Status: Accepted
- Date: 2026-09-28

## Context

Every record of one accepted commit shares one cursor. `readSyncChanges` in
`packages/storage-server/src/snapshots.ts` limited single records, and
`getChanges` in `packages/core/src/files/snapshot.ts` answers the cursor of the
last record as the next cursor. A page that ended inside a commit therefore
lost the rest of that commit, and no later read could return it.
[Issue 193](https://github.com/bkhanale/notesapp/issues/193) holds the served
reproduction. [Plan 016](../plans/016-websocket-sync.md) needs a lossless feed
before a wake notice can drive it.

A commit is bounded. `maxFilesPerChangeset` in
`packages/core/src/files/commit.ts` bounds a changeset, one purge touches at
most as many files, and a membership change writes one record.

## Decision

- A page of the feed ends only at the end of a commit. The limit is the
  largest page that the reader asks for. The server stops before a commit that
  does not fit.
- When the first commit after the cursor is larger than the limit, the page
  holds that one commit whole.
- `maxFilesPerChangeset` bounds a commit of every writer, so it is the
  largest page. `purgeFiles` in `packages/core/src/history/purge.ts` refuses a
  larger purge, and `SyncChanges` in `packages/api-contract/` declares that
  bound.
- The cursor stays the decimal cursor of one commit. The next cursor is the
  cursor of the last record, as before. No continuation inside a commit exists.

This excludes a composite cursor. A composite cursor keeps a page at the limit,
but it changes the cursor format that every shipped device stores and sends.

## Consequences

- A shipped device needs no update. It sends no limit and reads each page
  whole, so a server deploy alone repairs its feed.
- A page can hold up to `maxFilesPerChangeset` records. A changeset request of
  that size already carries the same documents, so the bound of one answer
  follows the bound of one request.
- A device that read a split page before this record can miss records of that
  commit. A later change of the same note gives a document gap and a fresh
  snapshot. A note that does not change again stays behind until the device
  starts a snapshot.
- The served tests in `tests/integration/snapshots.test.ts` read every page
  and prove that each record arrives once and that no commit spans two pages.
