# packages/storage-server

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The PostgreSQL side: the schema, the reviewed migrations, the roles and row
access policies, the workspace store, the identity store, the attachment
bytes, and provisioning. It implements the ports that `packages/core` owns.

## What lives here and what does not

- `src/schema.ts` is the Drizzle schema. `migrations/` holds the applied SQL
  and `migrations/meta/_journal.json` holds their order.
- `src/workspace-store/` implements `WorkspaceStore`: `transaction.ts` is the
  unit of work, one repository per context holds the SQL, and `index.ts` is the
  composition root. `src/admin.ts`, `src/identity-store.ts`, `src/profiles.ts`,
  `src/snapshots.ts`, `src/attachments.ts`, and `src/attachment-row.ts`, which
  refuses a stored value outside its union (0019), own their own areas.
- `src/migrate.ts` runs the migrations with the migration role and exports
  `requiredSchemaVersion`.
- No domain rule and no HTTP route live here. A rule lives in `packages/core`.

## Allowed imports

`@notesapp/core` and `@notesapp/markdown`, plus `drizzle-orm` and `pg`.

`@notesapp/markdown` is allowed because an accepted index update parses
Markdown in the same transaction that advances a head. This package is Node
only, so it may use Node built in modules. A browser package cannot import it.

## How to add a common thing here

- **A port method.** Add the SQL in the repository of that context under
  `src/workspace-store/`, and return the shape that the port in
  `packages/core/src/files/ports.ts` declares.
- **A schema change.** Edit `src/schema.ts`, run `pnpm db:generate`, review
  the emitted file, and add it as the next number in `migrations/`. Raise
  `requiredSchemaVersion` in `src/migrate.ts` to the new number of journal
  entries in the same change, because the readiness probe compares the two.
- **A SQL function.** Write it in the migration with its own membership
  check, and make it `SECURITY DEFINER` only when it must be. It returns one
  narrow answer.

## Testing conventions here

A pure module such as `excerpt.ts` or `markdown-limits.ts` has a `*.test.ts`
next to it and runs under `pnpm test:unit`. Everything that needs a database
is an integration test in `tests/integration/`, which creates a disposable
database per file against the real PostgreSQL service from
`compose.test.yaml`. Start the service once with
`tools/test-database/ensure-postgres.sh`. A storage test must prove the row
access rule as well as the result: `row-access.test.ts` is the pattern.

## Forbidden here

- No write outside a transaction. One call to `transact` opens one
  transaction, sets the actor identity for that transaction only, and takes
  the workspace advisory lock, so the commit ordered cursor cannot skip a
  transaction that commits late.
- No SQL function that reads or writes workspace data without a membership
  check.
- No schema change without a migration file and a raised
  `requiredSchemaVersion`.
- No edit of a migration that is already applied. Add the next number.
- No superuser and no `BYPASSRLS` on the migration role.
- No import from a browser package, and no import of this package by one.

## Key files

| File                                 | Purpose                                    |
| ------------------------------------ | ------------------------------------------ |
| `src/index.ts`                       | The one public entry point                 |
| `src/workspace-store/index.ts`       | The store and its per-context repositories |
| `src/workspace-store/transaction.ts` | The transaction unit of work               |
| `src/migrate.ts`                     | Migration run and `requiredSchemaVersion`  |
| `migrations/0000_initial.sql`        | The base schema, roles, and policies       |
| `migrations/meta/_journal.json`      | The applied order and the version count    |
