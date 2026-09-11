# 0011. Shared contract definitions and one initial migration

- Status: Accepted
- Date: 2026-09-10

## Context

The generated contract index held 259 dereferenced copies of the error
schema, and validators were compiled once per operation. The database carried
eleven migrations, several dead tables and functions, and a journal ordering
defect.

## Decision

The generated contract index uses one `$defs` block instead of dereferenced
copies. Validators are cached by schema digest. The eleven migrations are
squashed into one initial migration, which also removes the dead tables and
functions and the journal ordering defect. Squashing is allowed because no
installation holds real data.

## Consequences

- `packages/storage-server/migrations/0000_initial.sql` is the base schema.
  Every later change is a new numbered file, and `requiredSchemaVersion` in
  `packages/storage-server/src/migrate.ts` is raised in the same change.
- Squashing is a one time action. It is not repeated once an installation
  holds real data.
- Generation stays deterministic, and `pnpm generated:check` compares the
  committed output with the contract.
