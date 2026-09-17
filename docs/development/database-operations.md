# Running the database

`packages/storage-server` owns the unit of work, the migrations, the search
index, the stored attachment bytes, and the disposable database of the checks.
This page states what one transaction does, how a change reaches an
installation, and how the bytes are kept. [Database](database.md) states the
access model and the invariants that the schema holds.

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

## The test database

`compose.test.yaml` runs one pinned PostgreSQL service on a port that cannot
collide with an installed one. Its superuser initializes the service only, and
`tools/test-database/init.sql` creates the non superuser migration role, so
every check runs under the production role model.
`tests/integration/support/database.ts` makes one disposable database per test
file and drops only what it created. It and `src/admin.ts` both refuse a
database whose name is not a test name, so no operator database can be created
or dropped through that path.
