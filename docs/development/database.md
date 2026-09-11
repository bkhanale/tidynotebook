# Database

`packages/storage-server` owns the PostgreSQL schema, the reviewed migrations,
the roles, and the row access policies. It is a Node only package, and the
boundary checker refuses a browser import of it.

`src/schema.ts` is the schema and `migrations/` is what an installation ran.
Read those for a table, a column, or an index. This page states why they have
the shape they have.

## Scoping

Every table that holds workspace content carries a workspace identifier, and
every child reference is a composite foreign key to its parent. A row therefore
cannot point at a row of another workspace: the pair does not exist in the
parent table. PostgreSQL runs a referential check with the rights of the
referenced table, so the boundary holds even where a policy hides the parent.
Content is deduplicated inside one workspace only, so a workspace cannot learn
that another holds the same bytes.

The identity tables are the exception. Sign-in has to find a user by an address
before any identity exists, so no policy can narrow them by the account of the
transaction. A second database role owns them instead.

## Roles

Three credentials exist and they do not overlap.

- **The migration role** owns the schema and is the only credential that may
  run DDL. It must not be a superuser and must not hold `BYPASSRLS`: forced row
  level security has no effect on a role that can bypass it, so a superuser
  migration role would make every policy meaningless.
- **The runtime role** serves the application. It holds no DDL right, no
  bypass, and no `UPDATE` or `DELETE` right on an immutable or operator owned
  table.
- **The identity role** serves Better Auth. It is the only credential that can
  read a session token, a password hash, or a reset token, and it holds no
  right on any workspace table. The runtime role holds no right on the identity
  tables, so an application query cannot reach them however it sets its
  identity. The few facts the application needs from that side come from named
  `SECURITY DEFINER` functions that each return one narrow answer.

Two consequences reach the operator: an owner policy names the migration role
by the name it had when the migration ran, and the migration sets a password
with a DDL statement. Both are stated in
[Backup and restore](../guide/backup-and-restore.md).

## Row level security

Row level security is enabled and forced on every table that holds workspace
content. Each carries an owner policy for the migration role, which is what
lets the schema owner migrate and provision, and the runtime role gets narrower
policies. A role that matches no policy sees nothing, so a transaction that
sets no identity reads no row and writes no row.

The product serves one account, so these policies are defence in depth. The
application scopes every read and write first, and the policies prove that the
database refuses the same things on its own. Three shapes carry that.

- **A membership lookup is a `SECURITY DEFINER` function with a fixed search
  path.** A plain function would query the table its own policy guards, and
  PostgreSQL would report infinite recursion. Running as the schema owner
  avoids that and gives no role `BYPASSRLS`.
  `tests/integration/row-access.test.ts` proves it.
- **The quota and the commit cursor are operator owned.** The runtime role
  reads them and does not write them, because a member who could lower the
  stored byte count or rewind the cursor would defeat both. Two
  `SECURITY DEFINER` functions make the permitted changes, check membership
  first, and refuse a negative usage delta.
- **A rule that needs more than one row is a trigger.** A policy sees one row
  at a time, so it cannot count the remaining owners of a workspace.

Every function that changes state compares its caller with `IS DISTINCT FROM`
rather than `<>`, because a stranger has no role at all and `<> 'owner'` is
null for a null role rather than true.

Identity is set per transaction with a transaction local setting, so it
disappears at commit or rollback and cannot reach the next user of a pooled
connection. An integration test reads that setting on a pooled connection
outside a transaction to prove the absence of a leak.

Public sharing left the product. No table, function, or policy serves an
anonymous reader.

## Immutability

Content, revisions, revision parents, changesets, and receipts refuse `UPDATE`
and `DELETE`, and two independent controls hold that. The runtime role holds no
such right, so it is refused before any trigger runs. A role that does hold the
right still needs an explicit purge setting in its own transaction, and that
purge is a `SECURITY DEFINER` function of the schema owner. No runtime
credential reaches the bypass, and the bypass is useless without the right.

## Migrations

Each migration has two halves: the generated tables, keys, and indexes, and the
handwritten SQL after the banner. Drizzle cannot express a role, a grant, a
policy, a trigger, a deferrable constraint, or a stored function, so those
statements are written and reviewed by hand.

- `pnpm db:generate` writes the next migration from `src/schema.ts`. It
  connects to no database and writes nothing when the schema did not change.
- Never edit an applied migration. The applied set would disagree with the
  file, and the driver would not reapply it. Add the next number instead.
- The stored schema version function returns the number of journal entries, and
  `requiredSchemaVersion` in `src/migrate.ts` is what the readiness probe
  compares it with. A new migration raises both in the same change, so a
  container that serves without its migrations never reports ready.
- `pnpm db:migrate` requires an explicit profile, and each profile refuses a
  database whose name does not match it, so no default can point a developer
  command at an operator database. The deployment profile reads protected
  operator files rather than environment values, so a URL and a password never
  reach a process list or a shell history.

## The deferrable accepted path

A live path must be unique inside a workspace, and one changeset must be able
to swap two paths. A partial unique index cannot express that, because an index
constraint cannot be deferred and the first statement of a swap would fail. The
accepted paths therefore live in their own table with a deferrable unique
constraint, and a deleted file releases its row. The commit makes the
constraint immediate before it returns, so a conflict surfaces inside the call
as a domain result rather than at commit time, and then restores the deferred
mode so a second changeset can swap paths again. The head reference is deferred
for the same reason: one transaction writes the revisions and then advances the
heads.

## Search

One row holds the name and the body of each live note, and the name weighs more
than the body. The index holds the workspace identifier ahead of the document,
so a search of one workspace never reads the postings of another. The index
expression and the search function have to stay identical, or the planner
cannot use the index. The function builds its query from the words of the typed
text and keeps letters and digits only, so no part of the text reaches the
parser as an operator. The last word also matches as a prefix, which is what
makes search as you type work. An excerpt arrives with control characters
around each match, so no markup reaches a reader.

## Attachment bytes and the reclaim

Attachment bytes live on the private volume, not in the database, and finalized
bytes are content addressed, so several objects of one workspace can share one
file. `reclaimAttachments` in `src/attachments.ts` is the only code that
deletes them, and the daily job in `apps/server/src/jobs` calls it. Nothing
else unlinks a file, so there is one place to reason about and one to test. A
run takes only what is dead: an abandoned upload, a finalized object that no
revision has named for a whole day, and an object a purge already decided is
gone. A claim marks the row in one statement that matches only an unclaimed
row, so a second run and a second process get nothing and delete nothing.

The check that a shared file is still needed and the deletion itself stay in
one transaction that holds the workspace lock. A finalize takes the same lock,
so it cannot pass between the two: it waits, finds no file at the immutable
path, and moves its own upload there. A check after the commit reopens that
race and leaves a row whose file is gone. A purge skips an object finalized
seconds ago for the same reason: it sits between its finalize call and the
commit that will reference it. A workspace deletion copies the object
references into a queue with no foreign key to the workspace, because those
rows outlive the workspace row.

## Transaction shape

`transact` opens one transaction, sets the actor identity for that transaction
only, takes the workspace advisory lock, and then checks that the workspace is
visible. The lock is advisory and not a row lock, because a row lock would need
an update right on the workspace row that most actors do not hold. The
visibility check runs after the lock, and a hidden workspace and a missing one
are the same answer: storage cannot tell them apart and must not try.

`accept` runs inside a savepoint, so an expected domain outcome rolls back to
it and returns a result, the transaction stays usable, and no partial state
survives. Only a named constraint maps to a domain code. Every other SQL
failure stays an operational error, and only a real database failure becomes
one, so a use case above this port keeps its own error type. The step order is
in [Files, revisions, and atomic changes](files-and-revisions.md).

A driver error carries the failed statement, its parameters, and the server
detail and hint fields. All four echo note text and file paths, so the
operational error never forwards the original value. Its cause is rebuilt from
the SQLSTATE, the constraint name, the table name, and the server routine.

## Quota

Stored bytes count new content plus a fixed charge for the retained revision
metadata and the receipt. A changeset may use the small control reserve only
when every revision in it is a deletion, because a deletion must stay possible
on a full workspace. Without that rule a client could grow the stored byte
count without limit by resubmitting content the workspace already holds.

## The test database

`compose.test.yaml` runs one pinned PostgreSQL service on a port that cannot
collide with an installed one. Its superuser initializes the service only, and
`tools/test-database/init.sql` creates the non superuser migration role, so
every check runs under the production role model.
`tests/integration/support/database.ts` makes one disposable database per test
file and drops only what it created. It and `src/admin.ts` both refuse a
database whose name is not a test name, so no operator database can be created
or dropped through that path.

## What the schema does not hold

Sharing, conflict branches, invitations, workspace members, agent tokens, and
the workspace scoped audit trail left the product. No table, function, policy,
trigger, or enum value for any of them remains. The browser store keeps its own
short list of dead structures. See
[Local drafts and explicit saves](local-storage.md).
