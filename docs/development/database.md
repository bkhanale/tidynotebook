# Database

`packages/storage-server` owns the PostgreSQL schema, the reviewed migrations,
the roles, and the row access policies. It is a Node only package. A browser
package must never import it, and the boundary checker enforces that.

Verified on 2026-09-06 against PostgreSQL 18.6 in
`compose.test.yaml`.

## Pinned versions

| Package       | Version | Group                                       |
| ------------- | ------- | ------------------------------------------- |
| `drizzle-orm` | 0.45.2  | `packages/storage-server` dependency        |
| `pg`          | 8.23.0  | `packages/storage-server` dependency        |
| `drizzle-kit` | 0.31.10 | `packages/storage-server` development       |
| `@types/pg`   | 8.23.1  | `packages/storage-server` development       |
| PostgreSQL    | 18.6    | `compose.test.yaml`, pinned by image digest |

`pg` 8.23.0 and `drizzle-orm` 0.45.2 are the newest stable releases. The newest
stable `@types/pg` is 8.23.1, one patch above the design's note, so that patch
is pinned. Drizzle publishes 1.0.0 release candidates only; the dependency
policy forbids a prerelease, so 0.45.2 and 0.31.10 stay.

`packages/storage-server` sets `skipLibCheck: true`. The published Drizzle
declarations do not compile under TypeScript 7 with the strict base settings;
they report errors in the Gel, MySQL, and SingleStore dialect files that this
package never loads. Application sources are still checked in full.

## Schema

Twenty one tables live in the `public` schema. Every table that holds workspace
content carries `workspace_id`, and every child reference is a composite
foreign key `(workspace_id, ...)` to its parent. A row therefore cannot point
at a row of another workspace: the pair does not exist in the parent table.
PostgreSQL runs referential checks with the referenced table's rights, so this
boundary holds even where a row access policy hides the parent.

| Table                         | Holds                                                      |
| ----------------------------- | ---------------------------------------------------------- |
| `accounts`                    | Application owned account identity, with no personal data. |
| `workspaces`                  | One workspace.                                             |
| `memberships`                 | One role of one account in one workspace.                  |
| `workspace_usage`             | Stored bytes and the operator quota.                       |
| `workspace_cursors`           | The last allocated commit ordered cursor.                  |
| `files`                       | Accepted head, path, kind, and deletion state.             |
| `live_paths`                  | The accepted path of every live file.                      |
| `contents`                    | Immutable Markdown or an attachment reference, by digest.  |
| `revisions`                   | One immutable revision.                                    |
| `revision_parents`            | Parent edges, in submitted order.                          |
| `changesets`                  | One atomic operation and its cursor.                       |
| `mutation_receipts`           | The stored outcome of an accepted mutation.                |
| `branches`                    | A divergent tip and its conflict group.                    |
| `purge_markers`               | A content free marker of a permanently deleted file.       |
| `audit_events`                | Content free records of protected actions.                 |
| `sync_changes`                | Commit ordered incremental change records.                 |
| `snapshots`, `snapshot_items` | A bounded materialized download snapshot.                  |
| `link_index`                  | Links found in accepted revisions.                         |
| `shares`                      | A pinned public publication and its token hash.            |
| `attachment_objects`          | Immutable attachment objects on the private volume.        |

Content is deduplicated by `(workspace_id, digest)` only, so one workspace
cannot learn that another holds the same bytes.

### Accepted paths and the deferrable constraint

A live path must be unique inside a workspace, and a changeset must be able to
swap two paths atomically. A partial unique index on
`files (workspace_id, path) where deleted = false` cannot express that: an index
constraint cannot be deferred, so the first statement of a swap would fail.

The accepted paths therefore live in their own table:

```sql
create table live_paths (
  workspace_id uuid not null,
  file_id uuid not null,
  path text not null,
  primary key (workspace_id, file_id)
);
alter table live_paths
  add constraint live_paths_path_key unique (workspace_id, path)
  deferrable initially deferred;
```

A file holds a row here only while it is live. A deleted file releases its row,
and a file that exists only on a conflict branch never receives one, so pending
branch only files occupy no accepted path.

`accept` writes every path change, then runs `set constraints all immediate`
before it returns. A conflict therefore surfaces inside the call as the
`path_conflict` domain result rather than as a failure at commit time. The call
then restores the deferred mode, so a second changeset in the same transaction
can swap paths again.

`files.head_revision_id` uses a deferred composite foreign key to `revisions`
for the same reason: one transaction writes the revisions and advances the
heads.

## Roles

| Role           | Purpose                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| migration role | Owns the schema. The only credential that may run DDL. It needs `CREATEROLE`, because the migration creates the runtime role. `compose.test.yaml` names it `notesapp_migrate`. |
| `notesapp_app` | The application runtime credential. `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, `NOSUPERUSER`, and no `CREATE` right on the schema.                                           |

`REVOKE CREATE ON SCHEMA public FROM PUBLIC` and the database level
`REVOKE ALL ... FROM PUBLIC` keep the runtime role out of DDL and out of every
other database. The migration creates `notesapp_app` without a password; the
migration command then sets the password from a protected value, so no password
is stored in a committed SQL file.

The runtime role holds `SELECT` and `INSERT` only on `contents`, `revisions`,
`revision_parents`, `changesets`, and `mutation_receipts`. It therefore cannot
change or remove an immutable row at all.

## Row level security

Row level security is enabled and forced on every workspace scoped table, on
`workspaces`, and on `accounts`. Each table carries two policies:

- `<table>_owner_policy`, `FOR ALL TO <migration role> USING (true)`. The
  schema owner runs migrations, provisioning, and the SECURITY DEFINER helpers.
- `<table>_member_policy`, `FOR ALL TO notesapp_app`, with the predicate
  `notesapp_is_member(workspace_id)`.

`mutation_receipts` adds `actor_account_id = notesapp_current_account()`, so a
replay cannot read the stored outcome of another account. `workspaces` uses
`notesapp_is_member(id)` and `accounts` uses `id = notesapp_current_account()`.
Task 5 widens the account policy to the co-members that a membership list must
show.

A role that matches no policy sees nothing, so an anonymous transaction with no
identity setting reads no row and writes no row.

### Identity per transaction

`transact` runs `select set_config('notesapp.account_id', $1, true)` as its
first statement. The `true` argument makes the setting transaction local, so it
disappears at commit or rollback and cannot reach the next user of a pooled
connection. `WorkspaceStoreHandle.readConnectionIdentity()` reads the setting of
a pooled connection outside a transaction; the integration test asserts that it
is `null` after a transaction that set it.

`notesapp_current_account()` reads the setting and returns `null` when it is
absent or empty.

### A non-recursive membership policy

The membership policy calls `notesapp_is_member(workspace_id)`. That function
queries `memberships`, so a plain function would evaluate the policy again and
PostgreSQL would report infinite recursion.

`notesapp_is_member` is therefore `SECURITY DEFINER` with a fixed
`search_path`. It runs as the schema owner, whose policy on `memberships` is a
plain `true`, so the lookup never evaluates the member policy. No role needs
`BYPASSRLS` for this, and the runtime role stays fully constrained.

`tests/integration/row-access.test.ts` proves the property with a plan, a self
join over `memberships`, and a correlated subquery over `memberships`.

### The public share path

`notesapp_share_lookup(token_hash text)` is the only way an anonymous reader
reaches content. It is `SECURITY DEFINER`, it resolves one token hash to
exactly one pinned revision with its Markdown and its allowed attachment
revisions, and it returns nothing for a revoked share, an expired share, or a
deleted file. The runtime role holds `EXECUTE` on it and still reads no table
row without an identity, which the integration test checks.

## Immutability

`contents`, `revisions`, `revision_parents`, `changesets`, and
`mutation_receipts` reject `UPDATE` and `DELETE` through the
`notesapp_reject_row_change()` trigger, which raises SQLSTATE `23001`.

Two independent controls protect these rows:

1. The runtime role holds no `UPDATE` or `DELETE` right on them, so it is
   rejected with SQLSTATE `42501` before the trigger runs.
2. A role that does hold those rights, such as the schema owner, still needs
   `set_config('notesapp.purge', 'on', true)` in its own transaction. That is
   the explicit purge path. Task 8 adds the owner only purge as a
   `SECURITY DEFINER` function of the schema owner; no runtime credential can
   reach the bypass, because the bypass is useless without the table right.

## Migrations

Migrations live in `packages/storage-server/migrations/` with the Drizzle
journal. File names come from Drizzle; this repository assigns no numbers.

| Command                            | Effect                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| `pnpm db:generate`                 | `drizzle-kit generate` writes the next schema migration.      |
| `pnpm db:migrate --profile test`   | Applies every pending migration to the Compose test database. |
| `pnpm db:migrate --profile deploy` | Applies them to the operator database.                        |

`pnpm db:generate` never connects to a database and produces no file when the
schema has not changed.

Roles, policies, triggers, and the deferrable constraint are SQL that Drizzle
cannot express. They live in a custom migration created once with
`pnpm --filter @notesapp/storage-server exec drizzle-kit generate --custom --name row_access`.
Drizzle writes an empty file for that command, so the SQL in it is handwritten
and reviewed, not generated output. A later schema change adds a new generated
migration and does not touch it.

### Profiles

The command requires an explicit profile, so no default can point a developer
command at an operator database.

| Profile  | Connection source                                         | Runtime password source                                  | Guard                                                  |
| -------- | --------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `test`   | `NOTESAPP_TEST_DATABASE_URL`, otherwise the Compose value | `NOTESAPP_RUNTIME_PASSWORD`, otherwise the Compose value | The database name must start with `notesapp_test`.     |
| `deploy` | The file at `NOTESAPP_DATABASE_URL_FILE`                  | The file at `NOTESAPP_RUNTIME_PASSWORD_FILE`             | The database name must not start with `notesapp_test`. |

The deployment profile reads protected operator files rather than environment
values, so a URL and a password do not appear in a process list or a shell
history. Both files hold one trimmed line.

## Test database procedure

```sh
sudo -n docker compose -f compose.test.yaml up -d --wait
pnpm db:migrate --profile test
pnpm test:integration -- storage
pnpm test:integration -- row-access
```

`compose.test.yaml` runs one PostgreSQL 18.6 service, pinned by digest, on host
port 55432 so it cannot collide with an installed PostgreSQL. Its
`POSTGRES_USER` is the migration role and its database is `notesapp_test`. The
passwords in that file are test values of a throwaway local service and belong
to no deployment.

`tests/integration/support/database.ts` creates one disposable database named
`notesapp_test_<random>` for each test file, applies the migrations, and returns
the migration URL and the runtime URL. It refuses to run unless the server URL
selects a `notesapp_test` database, and it drops only the database that it
created. `packages/storage-server/src/admin.ts` applies the same guard to both
the server name and the new name, so no operator database can be created or
dropped through that path.

## Quota accounting

`workspace_usage` counts new content bytes plus a fixed charge for retained
revision metadata and for the mutation receipt. A changeset that adds content
must fit below `quota_bytes` minus a 1 MiB control reserve.

A changeset that adds no new content is a control operation: a deletion, a
rename, or a restore of content that the workspace already holds. It skips the
quota check, so a full workspace stays manageable and a delete always fits. New
content cannot consume that headroom, because only a control operation may pass
the check while the workspace is above the reserve line.

## Transaction shape

```text
transact(actor, workspaceId, run)
  begin
  set_config('notesapp.account_id', actor.accountId, true)
  select id from workspaces where id = $1 for update
  run(tx)          role, receipt, heads, parents, isPurged, accept
  commit
```

`accept` runs inside a savepoint:

```text
savepoint notesapp_accept
  lock the affected files in identifier order
  insert missing file rows
  resolve attachment objects and insert deduplicated content
  check and update the quota
  allocate the cursor under the workspace lock
  insert the changeset, the revisions, and the parent edges
  advance every head in one statement
  release and claim accepted paths
  insert sync records and the mutation receipt
  set constraints all immediate
release savepoint notesapp_accept
```

An expected domain outcome rolls back to the savepoint and returns a `Result`,
so the open transaction stays usable and no partial result survives. Only the
named constraints below map to a domain code; every other SQL failure stays an
`OperationalError`.

| Constraint                                                     | Domain code       |
| -------------------------------------------------------------- | ----------------- |
| `live_paths_path_key`                                          | `path_conflict`   |
| `changesets_mutation_key`, the `mutation_receipts` primary key | `mutation_reused` |
| the revision, parent, content, and head foreign keys           | `invalid_graph`   |

The cursor is a PostgreSQL `bigint` and leaves the store as a decimal string,
so no JavaScript number truncates it.

## What Task 4 does not do

The commit use case, the expected head checks, the purge path, snapshots,
attachments, search, and sharing operations are later tasks. This task provides
the schema they need, the storage ports, and the access controls.
