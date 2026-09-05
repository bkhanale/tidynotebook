# Database

`packages/storage-server` owns the PostgreSQL schema, the reviewed migrations,
the roles, and the row access policies. It is a Node only package. A browser
package must never import it, and the boundary checker enforces that.

Verified on 2026-09-06 against PostgreSQL 18.6 in `compose.test.yaml`.

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

Thirty tables live in the `public` schema: twenty one for workspace content,
and nine that Task 5 added for identity. Every table that holds
workspace content carries `workspace_id`, and every child reference is a composite
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

Task 5 added the identity tables. The first four belong to Better Auth; the
last five are the application's own.

| Table                  | Holds                                                      |
| ---------------------- | ---------------------------------------------------------- |
| `auth_user`            | One Better Auth user: address, display name, verification. |
| `auth_session`         | One browser session and its token.                         |
| `auth_account`         | One credential or one external identity, and its tokens.   |
| `auth_verification`    | One short lived verification value, such as a reset token. |
| `account_identities`   | The map from a Better Auth user to an application account. |
| `account_preferences`  | Settings that follow one account to every device.          |
| `account_audit_events` | Content free records of protected actions of one account.  |
| `agent_tokens`         | One revocable agent token, by the hash of its secret.      |
| `invitations`          | One invitation to one workspace, by its token hash.        |

The four Better Auth tables are not scoped by a workspace. Sign-in must find a
user by an address before any identity exists, so no row policy can narrow them
by the account of the transaction. A second database role owns them instead;
see "Roles" below. `docs/development/identity.md` describes the rules above
these tables.

`workspaces.personal` marks the workspace that was created together with its
account.

Content is deduplicated by `(workspace_id, digest)` only, so one workspace
cannot learn that another holds the same bytes. `contents.object_id` carries a
composite foreign key to `attachment_objects (workspace_id, id)`, so content
cannot name an object of another workspace either.

`revisions.server_time` and `changesets.server_time` are the acceptance time.
They default to `clock_timestamp()`, not `now()`, so two changesets written in
one transaction keep the order of their cursors.

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

| Role            | Purpose                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| migration role  | Owns the schema and the database. The only credential that may run DDL.                                                                     |
| `notesapp_app`  | The application runtime credential. No DDL, no row security bypass, and no `UPDATE` or `DELETE` right on an immutable or an operator table. |
| `notesapp_auth` | The identity credential. Every right on the four Better Auth tables, and no right anywhere else.                                            |

The two application roles split the identity data from the workspace data.
`notesapp_auth` is the only credential that can read a session token, a
password hash, a reset token, or a provider token, and only the Better Auth
connection uses it. `notesapp_app` holds no right on those four tables at all,
so an application query cannot reach them however it sets its identity, and
`notesapp_auth` holds no right on any workspace table, so the identity
connection cannot read note content. The few facts the application needs from
the identity side come from named SECURITY DEFINER functions that return one
narrow answer each.

The migration role needs:

- **schema ownership**, to create and alter the tables and to force row level
  security on them;
- **database ownership**, for the `REVOKE ALL ON DATABASE` and
  `GRANT CONNECT` statements of the migration;
- **`CREATEROLE`**, because the migration creates `notesapp_app` and
  `notesapp_auth`;
- **`CREATEDB`** in the test service only, so the integration tests can create
  a disposable database for each test file.

The migration role **must not be a superuser** and must not hold `BYPASSRLS`.
FORCE row level security has no effect on a role that can bypass it, so a
superuser migration role would make the owner policies, and therefore every
row access check that runs against them, meaningless.

The migration creates both application roles with the plain `CREATE ROLE` defaults,
which are already `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`,
and `NOREPLICATION`. It never sets those attributes in an `ALTER ROLE`: from
PostgreSQL 16 a `CREATEROLE` role that is not a superuser cannot set them, so
an `ALTER` would fail on the second database of a cluster, where the role
already exists. When the role exists the migration reads `pg_roles` instead and
raises an exception if the role is `SUPERUSER`, `BYPASSRLS`, or `REPLICATION`.

`REVOKE CREATE ON SCHEMA public FROM PUBLIC` and the database level
`REVOKE ALL ... FROM PUBLIC` keep the runtime role out of DDL and out of every
other database.

### Operator notes

- The migration sets the runtime password with `ALTER ROLE ... WITH PASSWORD`.
  PostgreSQL redacts that statement in the server log only when
  `log_statement` is off and the statement is not otherwise captured. An
  installation that runs `log_statement = 'ddl'` or `'all'`, or that captures
  the statement through `pgaudit`, will hold the password in its log. Rotate
  the runtime password after enabling such logging, and keep the log under the
  same encryption policy as the data.
- The owner policies name the migration role **by the name it had when the
  migration ran**. A restore into a cluster where the schema owner has a
  different name leaves that new owner without a policy, and FORCE row level
  security then hides every row from it. Restore under the same role name, or
  re-point the owner policies with `ALTER POLICY ... TO <new owner>` for every
  table before using the installation.

## Row level security

Row level security is enabled and forced on every workspace scoped table, on
`workspaces`, and on `accounts`. Each table carries an owner policy,
`FOR ALL TO <migration role> USING (true)`, which is what lets the schema owner
migrate, provision, and run the SECURITY DEFINER helpers. The runtime role gets
narrower policies.

| Table                        | Runtime role policy                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every workspace scoped table | `FOR ALL` with `notesapp_is_member(workspace_id)`                                                                                                                                                                                                                                                                                                                       |
| `mutation_receipts`          | the same, plus `actor_account_id = notesapp_current_account()`                                                                                                                                                                                                                                                                                                          |
| `workspaces`                 | `FOR SELECT` for members; `FOR UPDATE` only for `owner` or `admin`                                                                                                                                                                                                                                                                                                      |
| `memberships`                | `FOR SELECT` for members; insert, update, and delete only for `owner` or `admin`, never on the actor's own row, and the `owner` role only from an `owner`. The last owner rule is not expressed here: a policy sees one row at a time and cannot count the remaining owners. Task 5's workspace use case enforces it inside the same workspace lock as a content write. |
| `accounts`                   | `notesapp_shares_workspace_with(id)`: the account itself and every co-member                                                                                                                                                                                                                                                                                            |

Task 5 replaced two of these policies and added a trigger:

- `accounts_member_policy` now shows the account row of a co-member, which is
  what a member list needs. Migration `0001` recorded that widening as work of
  Task 5.
- `memberships_delete_policy` now lets only an owner delete an owner. A delete
  that the policy refuses removes no row rather than failing, because a `USING`
  clause hides the row from the statement.
- `memberships_keep_owner` is a `BEFORE UPDATE OR DELETE` trigger that refuses
  a change which would leave a workspace without an owner. A policy sees one
  row at a time and cannot count the remaining owners, so the last owner rule
  needs a trigger. Workspace deletion sets `notesapp.purge` and is exempt,
  exactly like the immutability triggers. The core use case enforces the same
  rule first, inside the same workspace lock as a content write.

The Task 5 identity tables use these policies:

| Table                 | Policy                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| the four `auth_*`     | `FOR ALL` to `notesapp_auth` with `true`. `notesapp_app` holds no right at all.                     |
| `account_identities`  | The owner policy only. `notesapp_app` holds no right at all.                                        |
| `account_preferences` | `account_id = notesapp_current_account()`                                                           |
| `agent_tokens`        | `account_id = notesapp_current_account()`                                                           |
| `invitations`         | `FOR SELECT` for members; insert and update for `owner` or `admin`, and never with the `owner` role |

A role that matches no policy sees nothing, so an anonymous transaction with no
identity setting reads no row and writes no row.

### Operator owned records

Two records must not follow the general member policy, because a member could
otherwise raise its own limits:

- `workspace_usage` holds the quota. The runtime role has `SELECT` only.
- `workspace_cursors` holds the commit order. The runtime role has `SELECT`
  only, so a member cannot rewind the cursor and replay a sync stream.

Two SECURITY DEFINER functions of the schema owner make the permitted changes,
and both check membership first:

- `notesapp_next_cursor(workspace_id)` moves the cursor forward by exactly one
  and returns it.
- `notesapp_add_usage(workspace_id, delta)` changes the stored bytes only,
  never the quota, and refuses every negative delta with SQLSTATE `23514`. A
  member that could subtract would zero `bytes_used` and then write past the
  quota without limit, so the runtime path only ever adds. Task 8 lowers the
  stored bytes through its own owner only purge function.

Task 5 added eight more SECURITY DEFINER functions, for the writes that the
runtime role holds no right for and for the narrow reads that replace a right
on the identity tables:

| Function                                      | Answers or performs                                          |
| --------------------------------------------- | ------------------------------------------------------------ |
| `notesapp_link_account`                       | Creates an account, its map row, and its personal workspace. |
| `notesapp_create_workspace`                   | Creates a workspace owned by the calling account.            |
| `notesapp_transfer_ownership`                 | Moves ownership; owner only.                                 |
| `notesapp_delete_workspace`                   | Removes a workspace and its rows; owner only.                |
| `notesapp_claim_invitation`                   | Consumes one invitation in one statement.                    |
| `notesapp_open_invitation`                    | The workspace and the address of an open invitation.         |
| `notesapp_account_of`, `notesapp_has_account` | One account identifier, and whether any account exists.      |
| `notesapp_workspace_members`                  | The member directory of one workspace; members only.         |
| `notesapp_agent_token`                        | One agent token by the hash of its secret.                   |

Every function that changes state checks the caller's role with
`IS DISTINCT FROM` rather than `<>`, because a stranger has no role at all and
`<> 'owner'` is null for a null role rather than true.

### Identity per transaction

`transact` runs `select set_config('notesapp.account_id', $1, true)` as its
first statement. The `true` argument makes the setting transaction local, so it
disappears at commit or rollback and cannot reach the next user of a pooled
connection. `WorkspaceStoreHandle.readPooledIdentity()` reads the setting of a
pooled connection outside a transaction. It takes whichever connection the pool
hands out, so it proves the absence of a leak at pool size 1, which is what the
integration test uses.

`notesapp_current_account()` reads the setting and returns `null` when it is
absent or empty.

### A non-recursive membership policy

The membership policies call `notesapp_is_member(workspace_id)` and
`notesapp_member_role(workspace_id)`. Both query `memberships`, so a plain
function would evaluate the policy again and PostgreSQL would report infinite
recursion.

Both are therefore `SECURITY DEFINER` with a fixed `search_path`. They run as
the schema owner, whose policy on `memberships` is a plain `true`, so the
lookup never evaluates the member policies. No role needs `BYPASSRLS` for this,
and the runtime role stays fully constrained.

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

### Rewriting the initial pair

The review of Task 4 changed the schema and the access rules. The initial pair
`0000_slimy_ravenous.sql` and `0001_row_access.sql` was rewritten in place, and
their snapshots were regenerated, instead of adding an incremental `0002`
migration. This is correct only because no database outside a disposable
`notesapp_test` database has ever applied them: there is no installation whose
applied set would now disagree with the journal. Once an installation exists,
every change must be a new migration.

The rewrite used `drizzle-kit generate --name slimy_ravenous` for the schema
migration, so the file name stayed stable, followed by
`drizzle-kit generate --custom --name row_access` for the reviewed access
migration. Recreate the test service with
`sudo docker compose -f compose.test.yaml down -v` before applying a rewritten
migration, because the journal no longer matches the applied set.

### Profiles

The command requires an explicit profile, so no default can point a developer
command at an operator database.

| Profile  | Connection source                                         | Runtime password source                                  | Identity password source                                       | Guard                                                  |
| -------- | --------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `test`   | `NOTESAPP_TEST_DATABASE_URL`, otherwise the Compose value | `NOTESAPP_RUNTIME_PASSWORD`, otherwise the Compose value | `NOTESAPP_AUTH_DATABASE_PASSWORD`, otherwise the Compose value | The database name must start with `notesapp_test`.     |
| `deploy` | The file at `NOTESAPP_DATABASE_URL_FILE`                  | The file at `NOTESAPP_RUNTIME_PASSWORD_FILE`             | The file at `NOTESAPP_AUTH_PASSWORD_FILE`                      | The database name must not start with `notesapp_test`. |

The two passwords must differ, and each needs at least twelve characters. The
command refuses to run otherwise, so a deployment cannot end up with one shared
credential for both roles. The server then reads `NOTESAPP_DATABASE_URL` for
the runtime connection and `NOTESAPP_AUTH_DATABASE_URL` for the identity
connection, and startup fails when the two are the same value.

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
`POSTGRES_USER` is the image superuser and is used for initialization only.
`tools/test-database/init.sql` then creates the non superuser migration role
`notesapp_migrate` with `CREATEROLE` and `CREATEDB`, and the database
`notesapp_test` that it owns. Every check therefore runs under the production
role model. The passwords in those files are test values of a throwaway local
service and belong to no deployment.

`tests/integration/support/database.ts` creates one disposable database named
`notesapp_test_<random>` for each test file, applies the migrations, and returns
the migration URL and the runtime URL. It refuses to run unless the server URL
selects a `notesapp_test` database, and it drops only the database that it
created, with `DROP DATABASE ... WITH (FORCE)`.
`packages/storage-server/src/admin.ts` applies the same guard to both the server
name and the new name, so no operator database can be created or dropped
through that path.

## Quota accounting

`workspace_usage` counts new content bytes plus a fixed charge for retained
revision metadata and for the mutation receipt.

A changeset may use the 1 MiB control reserve only when **every** revision in
it has `deleted = true`. A deletion is the operation that must stay possible on
a full workspace. Every other changeset, including one that only reuses a digest
the workspace already stores, must fit inside `quota_bytes` minus the reserve,
because its revision rows and its receipt are still retained data. Without that
rule a client could grow `bytes_used` without limit by resubmitting stored
content.

## Content digests

`accept` recomputes the SHA-256 digest of submitted Markdown over its UTF-8
bytes and compares it with the declared digest in lower case hexadecimal. For
attachment content it compares the declared digest with the digest of the
finalized object. A mismatch returns the domain code `invalid_content`.

The check is required because content is addressed by digest and deduplicated
inside the workspace. A revision that declared a digest the workspace already
stores, with different text, would otherwise be recorded against bytes the
client never sent.

## Transaction shape

```text
transact(actor, workspaceId, run)
  begin
  set_config('notesapp.account_id', actor.accountId, true)
  pg_advisory_xact_lock(hashtext(workspaceId))
  select id from workspaces where id = $1     visibility check
  run(tx)          role, receipt, heads, parents, isPurged, accept
  commit
```

The workspace lock is an advisory transaction lock, not `SELECT ... FOR UPDATE`.
A viewer holds no `UPDATE` right on the workspace row, and the update policy
restricts the row to an owner or an admin, so a row lock would silently return
no row for most actors. The advisory lock has neither problem. A hash collision
between two workspaces costs extra serialization and nothing else. `hashtext` is
a PostgreSQL internal function whose result is not stable across releases; it is
used only to pick a transient lock number, and no stored value depends on it.

The visibility check runs after the lock. When the workspace row is not visible,
`transact` throws `WorkspaceUnavailableError` before the callback runs. That is
not an infrastructure failure: the policies hide a workspace that the account is
not a member of, so storage cannot tell a missing workspace from a hidden one
and must not try. An HTTP adapter maps the error to 404.

`accept` runs inside a savepoint:

```text
savepoint notesapp_accept
  lock the affected files in identifier order
  insert missing file rows
  resolve attachment objects, verify every content digest
  insert deduplicated content
  check the quota, then notesapp_add_usage
  notesapp_next_cursor under the workspace lock
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

### Which failures become an OperationalError

`transact` wraps a failure as an `OperationalError` only when it is a database
failure: the driver reported a SQLSTATE, or a socket code such as
`ECONNREFUSED`, `ENOTFOUND`, or `ETIMEDOUT`. `3D000` (no such database), `28000`
and `28P01` (refused login), every `08` code, and `57P03` (the server is
starting) map to the kind `unavailable`; `40001` and `40P01` map to
`serialization`; `57014` maps to `timeout`.

Any other value that the callback throws travels out unchanged. A use case
above this port, such as the commit use case of Task 6, therefore keeps its own
error type instead of finding it replaced by a storage error.

### Content free failure reporting

The driver's error, and the wrapper that Drizzle puts around it, carry the
failed statement, its bound parameters, and the PostgreSQL `detail` and `hint`
fields. All four echo note text and file paths, and a logger that walks `cause`
would write them out.

`OperationalError` therefore never forwards the original value. Its `cause` is
a rebuilt `DatabaseFailure` that keeps the SQLSTATE, the constraint name, the
table name, and the server routine, and nothing else. The same applies to a
refused connection: `transact` wraps `pool.connect()`, so a driver message that
repeats the host, the port, and the role never escapes.

## Migration history

| Migration                  | Contains                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `0000_slimy_ravenous.sql`  | The workspace content tables, generated by Drizzle.                                          |
| `0001_row_access.sql`      | Roles, row policies, immutability, and the deferrable path key.                              |
| `0002_furry_darkhawk.sql`  | The Task 5 identity tables and `workspaces.personal`, generated.                             |
| `0003_identity_access.sql` | The identity role, the identity policies, the owner guard trigger, and the Task 5 functions. |

`0002` and `0003` were rewritten in place during the review of Task 5, for the
same reason the initial pair was: no database outside a disposable
`notesapp_test` database has ever applied them. Recreate the test service with
`sudo docker compose -f compose.test.yaml down -v` before applying a rewritten
migration.

## What Task 4 does not do

The commit use case, the expected head checks, the purge path, snapshots,
attachments, search, and sharing operations are later tasks. Task 4 provides
the schema they need, the storage ports, and the access controls. Task 5 added
the identity tables, their roles and policies, and the account and membership
rules above them; see `docs/development/identity.md`.
