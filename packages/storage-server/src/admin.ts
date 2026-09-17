/**
 * Disposable database administration for local checks.
 *
 * These helpers create and destroy a database with the migration role. They
 * refuse every name that does not start with `notesapp_test`, so no operator
 * database can be created or dropped through this path.
 */
import pg from 'pg';
import {
  databaseName,
  isTestDatabaseName,
  withDatabaseName,
} from './profiles.ts';

/** Rejects a server URL or a database name outside the test namespace. */
function assertDisposable(serverUrl: string, name: string): void {
  const server = databaseName(serverUrl);
  if (!isTestDatabaseName(server)) {
    throw new Error(
      `notesapp: the server URL must select a notesapp_test database; found ${server}.`,
    );
  }
  if (!isTestDatabaseName(name)) {
    throw new Error(
      `notesapp: a disposable database must be named notesapp_test*; found ${name}.`,
    );
  }
}

/** Runs one statement that PostgreSQL itself has quoted. */
async function runQuoted(
  serverUrl: string,
  template: string,
  name: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    const built = await client.query<{ statement: string }>(
      'select format($1, $2::text) as statement',
      [template, name],
    );
    const statement = built.rows[0]?.statement;
    if (statement === undefined) {
      throw new Error('notesapp: the administration statement was not built.');
    }
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** Creates one disposable database on the Compose test server. */
export async function createTestDatabase(
  serverUrl: string,
  name: string,
): Promise<string> {
  assertDisposable(serverUrl, name);
  await runQuoted(serverUrl, 'create database %I', name);
  return withDatabaseName(serverUrl, name);
}

/** How long a drop waits for the sessions of a database to end. */
const sessionCloseTimeoutMs = 5000;

/**
 * Ends every session of one database, and answers how many were left.
 *
 * The migration role owns the database and holds `pg_signal_backend`, so it
 * may end the sessions of the runtime role as well. A session that this call
 * ends learns about it inside this call, which is the point: the drop below
 * then finds a database with nobody on it, and no client raises an error
 * after the test that opened it has finished.
 *
 * The loop repeats, because a pool can open a connection again between the
 * count and the signal. It gives up after `sessionCloseTimeoutMs` and states
 * what it found, so a teardown that cannot reach a quiet database is visible.
 */
async function endSessions(serverUrl: string, name: string): Promise<number> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    const deadline = Date.now() + sessionCloseTimeoutMs;
    for (;;) {
      // A row with no user name is a background worker of the server, such as
      // an autovacuum worker of this database. A role that is not a superuser
      // may not signal one, and it does not hold the database open either, so
      // the sessions of a person are the only rows that count here.
      const left = await client.query<{ count: string }>(
        'select count(*)::text as count from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() and usename is not null',
        [name],
      );
      const count = Number(left.rows[0]?.count ?? '0');
      if (count === 0) return 0;
      if (Date.now() >= deadline) return count;
      try {
        await client.query(
          'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() and usename is not null',
          [name],
        );
      } catch {
        // A session that this role may not end stays, and the count above
        // sends the drop to its forced form. The refusal is not a failure of
        // the teardown, so it never leaves this call.
        return count;
      }
      await new Promise((accept) => setTimeout(accept, 50));
    }
  } finally {
    await client.end();
  }
}

/**
 * Drops one disposable database.
 *
 * Every session of the database ends first, and the drop then runs plainly.
 * The drop used to carry `WITH (FORCE)`, which ends those sessions itself: a
 * client on the other end of one of them then raised an error of its own,
 * after its own test had finished, and the run reported "1 error was not a
 * part of any test" although every journey passed. Ending the sessions here
 * puts that moment inside this call, which the teardown awaits and owns.
 */
export async function dropTestDatabase(
  serverUrl: string,
  name: string,
): Promise<void> {
  assertDisposable(serverUrl, name);
  const left = await endSessions(serverUrl, name);
  // A session that would not end still must not keep the database, so the
  // drop falls back to the forced form. It states the count, so a teardown
  // that has to do this is visible rather than silent.
  await runQuoted(
    serverUrl,
    left === 0
      ? 'drop database if exists %I'
      : 'drop database if exists %I with (force)',
    name,
  );
}
