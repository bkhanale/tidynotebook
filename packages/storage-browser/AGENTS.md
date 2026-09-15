# packages/storage-browser

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The IndexedDB side. It implements the `LocalStore` port of `@notesapp/sync`
with Dexie: drafts, local versions, the save queue, receipts, the recovery
area, preferences, and the offline snapshot.

## What lives here and what does not

- `src/database.ts` and `src/migrations.ts` hold the schema and the record
  upgrades. `src/local-store/` implements the port, split by area (0018, below).
- No rule about what a save means lives here. That rule lives in
  `packages/sync` or `packages/core`. Nothing else opens a browser database.

## The `local-store/` module layout

`openLocalStore` in `index.ts` opens the database, owns the invalidation
channel, and composes these area modules behind the one port, each a factory
over the shared `LocalStoreContext` and kept small by `check-boundaries.mjs`:

- `channel.ts`: the message shape of the invalidation channel (0019).
- `shared.ts`: the context type and the cross-area row helpers.
- `drafts.ts`: save, read, rebase, drop a draft; read a cached note.
- `versions.ts`: checkpoint a save and list local history.
- `file-actions.ts`: move or trash a file, every working copy (0032).
- `queue.ts`: the save queue, the receipts, the local conflicts.
- `recovery.ts`: the recovery area and the private-data reset.
- `preferences.ts`: pins, the sign-out marker, the sync lease.
- `files.ts`: the reads over the cached mirror of server state.
- `snapshot.ts`: snapshots, remote changes, and the kept read of a screen.

## Allowed imports

`@notesapp/core` and `@notesapp/sync`, plus `dexie`.

This package is browser code. It cannot import a Node built in module, a Node
only package, or a server only package.

## How to add a common thing here

- **A table or an index.** Add the row type and the table name in
  `src/database.ts`, add the entry to `schemaVersions`, and add the record
  upgrade in `src/migrations.ts`.
- **A port method.** Add it to `LocalStore` in
  `packages/sync/src/local-port.ts` first, then implement it in the area
  module of `src/local-store/` that owns it and spread its slice from
  `src/local-store/index.ts`. Every write stays in one Dexie transaction.
- **A refusal.** Throw `LocalStorageError` with a `LocalStorageErrorKind`, so
  the application can tell the person what happened without an engine notice.

## Testing conventions here

A pure module has a `*.test.ts` next to it under `pnpm test:unit`. Everything
that opens a database is an integration test in
`tests/integration/browser-storage.test.ts`, which uses `fake-indexeddb`. A
storage test must prove that one failed step leaves no partial write, and a
migration test the upgrade from the earlier stored shape.

## Forbidden here

- No network call and no import of `@notesapp/api-client`.
- No write outside a Dexie transaction. A save writes the local version and
  the queue entry in one transaction.
- No schema change without a new `schemaVersions` entry and its upgrade.
- No silent data loss on a blocked or newer schema. Refuse loudly.
- No treatment of a draft as a server version. A draft is recovery data.

## Key files

| File                       | Purpose                                   |
| -------------------------- | ----------------------------------------- |
| `src/index.ts`             | The one public entry point                |
| `src/database.ts`          | Row shapes, table names, `schemaVersions` |
| `src/migrations.ts`        | Record upgrades and `ensureSchema`        |
| `src/local-store/index.ts` | The composition root and `openLocalStore` |
