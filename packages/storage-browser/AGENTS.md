# packages/storage-browser

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The IndexedDB side. It implements the `LocalStore` port of `@notesapp/sync`
with Dexie: drafts, local versions, the save queue, receipts, the recovery
area, preferences, and the offline snapshot.

## What lives here and what does not

- `src/database.ts` declares the row shapes, the table names, and
  `schemaVersions`.
- `src/migrations.ts` holds the record upgrades, `ensureSchema`, and the
  blocked upgrade instructions. `currentSchemaVersion` is the highest entry
  in `schemaVersions`.
- `src/local-store.ts` implements the port with Dexie transactions.
- No rule about what a save means lives here. That rule lives in
  `packages/sync` or in `packages/core`. Nothing else in the repository opens
  a browser database.

## Allowed imports

`@notesapp/core` and `@notesapp/sync`, plus `dexie`.

This package is browser code. It cannot import a Node built in module, a Node
only package, or a server only package.

## How to add a common thing here

- **A table or an index.** Add the row type and the table name in
  `src/database.ts`, add the entry to `schemaVersions`, and add the record
  upgrade in `src/migrations.ts`.
- **A port method.** Add it to `LocalStore` in
  `packages/sync/src/local-port.ts` first, then implement it in
  `src/local-store.ts` inside one Dexie transaction.
- **A refusal.** Throw `LocalStorageError` with a `LocalStorageErrorKind`, so
  the application can tell the person what happened without an engine notice.

## Testing conventions here

A pure module has a `*.test.ts` next to it under `pnpm test:unit`. Everything
that opens a database is an integration test in
`tests/integration/browser-storage.test.ts`, which uses `fake-indexeddb`. A
storage test must prove that one failed step leaves no partial write, and a
migration test must prove the upgrade from the earlier stored shape.

## Forbidden here

- No network call and no import of `@notesapp/api-client`.
- No write outside a Dexie transaction. A save writes the local version and
  the queue entry in one transaction.
- No schema change without a new entry in `schemaVersions` and its record
  upgrade.
- No silent data loss on a blocked or a newer schema. Refuse with
  `LocalStorageError` and report it.
- No treatment of a draft as a server version. A draft is recovery data.

## Key files

| File                 | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `src/index.ts`       | The one public entry point                |
| `src/database.ts`    | Row shapes, table names, `schemaVersions` |
| `src/migrations.ts`  | Record upgrades and `ensureSchema`        |
| `src/local-store.ts` | The `LocalStore` implementation           |
