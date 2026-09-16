# packages/storage-server

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The PostgreSQL side: the schema, the migrations, the roles and row access
policies, the workspace store, the reader path of a published link, the
identity store, the attachment bytes, and provisioning.

## What lives here and what does not

- `src/schema.ts` is the schema, `migrations/` holds the applied SQL, and
  `migrations/meta/_journal.json` holds their order.
- `src/workspace-store/` implements `WorkspaceStore`: `transaction.ts` is the
  unit of work, `publication-transaction.ts` is the read-only one of the reader
  path (0031), one repository per context holds the SQL, and `index.ts` is the
  composition root. `admin.ts`, `identity-store.ts`, `profiles.ts`,
  `snapshots.ts`, `attachments.ts` and `attachment-row.ts` (0019) own the rest.
- `src/migrate.ts` runs the migrations and exports `requiredSchemaVersion`.
- No domain rule and no HTTP route live here. A rule lives in `packages/core`.

## Allowed imports

`@notesapp/core` and `@notesapp/markdown`, plus `drizzle-orm` and `pg`.

`@notesapp/markdown` is allowed because an accepted index update and a
published read both parse Markdown. This package is Node only, so it may use a
Node module. A browser package cannot import it.

## How to add a common thing here

- **A port method.** Add the SQL in the repository of that context under
  `src/workspace-store/`, and answer the shape that its port declares.
- **A schema change.** Edit `src/schema.ts`, run `pnpm db:generate`, review the
  emitted file, and add it as the next number in `migrations/`. Raise
  `requiredSchemaVersion` to the new journal entry count in the same change.
- **A SQL function.** Write it in the migration with its own membership check.
  Make it `SECURITY DEFINER` only when it must be, and answer one narrow fact.
- **A published read.** Narrow the one scoped query of
  `publications-repository.ts`: it is the only read of a note there.

## Testing conventions here

A pure module such as `excerpt.ts` or `publication-row.ts` has a `*.test.ts`
next to it and runs under `pnpm test:unit`. Everything that needs a database is
an integration test in `tests/integration/`, which makes one disposable
database per file against the service of `compose.test.yaml`; start it with
`tools/test-database/ensure-postgres.sh`. A storage test proves the row access
rule as well as the result: `row-access.test.ts` is the pattern.

## Forbidden here

- No write outside a transaction. One call to `transact` opens one transaction,
  sets the actor identity for that transaction only, and takes the workspace
  lock, so the commit ordered cursor cannot skip a late commit.
- No write and no `Actor` on the reader path. Its transaction is read only, it
  adopts the owner account of the link that the token digest opened, and every
  read of a note binds the scope in the SQL (0030, 0031).
- No raw token and no raw ticket at rest. A digest column takes a SHA-256 in
  lower case hexadecimal and a check constraint refuses every other shape.
- No SQL function that reaches workspace data without a membership check, or,
  on the reader path, without the digest of a secret.
- No schema change without a migration file and a raised
  `requiredSchemaVersion`, and no edit of a migration that is already applied.
- No superuser and no `BYPASSRLS` on the migration role, no import from a
  browser package, and no import of this package by one.

## Key files

| File                                 | Purpose                                    |
| ------------------------------------ | ------------------------------------------ |
| `src/index.ts`                       | The one public entry point                 |
| `src/workspace-store/index.ts`       | The store and its per-context repositories |
| `src/workspace-store/transaction.ts` | The transaction unit of work               |
| `src/migrate.ts`                     | Migration run and `requiredSchemaVersion`  |
| `migrations/0000_initial.sql`        | The base schema, roles, and policies       |
| `migrations/meta/_journal.json`      | The applied order and the version count    |
