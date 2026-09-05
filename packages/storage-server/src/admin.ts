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

/**
 * Drops one disposable database.
 *
 * Existing sessions are closed first, because a test may leave a pooled
 * connection open until its process exits.
 */
export async function dropTestDatabase(
  serverUrl: string,
  name: string,
): Promise<void> {
  assertDisposable(serverUrl, name);
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );
  } finally {
    await client.end();
  }
  await runQuoted(serverUrl, 'drop database if exists %I', name);
}
