/**
 * Applies the reviewed SQL migrations with the migration role.
 *
 * The migration role owns the schema. It is the only credential that may run
 * DDL. The runtime role that the application uses is created by the migration
 * itself and receives its password here, so no password is stored in a
 * committed SQL file.
 *
 * The command requires an explicit profile. See `profiles.ts` for the guards
 * and `docs/development/database.md` for the operator procedure.
 */
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import {
  assertProfileDatabase,
  databaseName,
  parseProfile,
  type MigrationProfile,
} from './profiles.ts';

/** The name of the runtime role that the migration creates. */
export const runtimeRole = 'notesapp_app';

/** The reviewed migration directory of this package. */
export function migrationsFolder(): string {
  return fileURLToPath(new URL('../migrations/', import.meta.url));
}

/** What one migration run needs. */
export type MigrationRun = {
  /** A connection URL of the migration role. */
  readonly databaseUrl: string;
  /** The password that the runtime role receives after the migrations apply. */
  readonly runtimePassword: string;
};

/**
 * Applies every pending migration and sets the runtime role password.
 *
 * Applying the same migrations again is a no operation, because Drizzle keeps
 * the applied set in its own bookkeeping table.
 */
export async function runMigrations(run: MigrationRun): Promise<void> {
  if (run.runtimePassword.length < 12) {
    throw new Error(
      'notesapp: the runtime role password must have at least 12 characters.',
    );
  }
  const client = new pg.Client({ connectionString: run.databaseUrl });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
    // DDL cannot take a bind parameter, so PostgreSQL itself quotes the
    // literal and the result is executed as one statement.
    const built = await client.query<{ statement: string }>(
      'select format($1, $2::text) as statement',
      [`alter role ${runtimeRole} with password %L`, run.runtimePassword],
    );
    const statement = built.rows[0]?.statement;
    if (statement === undefined) {
      throw new Error('notesapp: the runtime role password was not built.');
    }
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/**
 * The connection values of the disposable Compose test service.
 *
 * They belong to `compose.test.yaml` and to no other service. The test profile
 * still refuses any database whose name does not start with `notesapp_test`,
 * so an overridden value cannot reach an operator database either.
 */
export const testDatabaseUrl =
  'postgres://notesapp_migrate:notesapp_migrate_test@127.0.0.1:55432/notesapp_test';
export const testRuntimePassword = 'notesapp_app_test_password';

/** Reads a required environment value. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`notesapp: set ${name}.`);
  }
  return value;
}

/** Reads a secret from a protected operator file. */
async function readSecretFile(name: string): Promise<string> {
  const path = required(name);
  return (await readFile(path, 'utf8')).trim();
}

/** The connection URL and the runtime password of one profile. */
async function loadProfile(profile: MigrationProfile): Promise<MigrationRun> {
  if (profile === 'test') {
    return {
      databaseUrl: process.env['NOTESAPP_TEST_DATABASE_URL'] || testDatabaseUrl,
      runtimePassword:
        process.env['NOTESAPP_RUNTIME_PASSWORD'] || testRuntimePassword,
    };
  }
  return {
    databaseUrl: await readSecretFile('NOTESAPP_DATABASE_URL_FILE'),
    runtimePassword: await readSecretFile('NOTESAPP_RUNTIME_PASSWORD_FILE'),
  };
}

/** The command entry point of `pnpm db:migrate --profile test|deploy`. */
export async function main(argv: readonly string[]): Promise<void> {
  const profile = parseProfile(argv);
  const run = await loadProfile(profile);
  assertProfileDatabase(profile, run.databaseUrl);
  await runMigrations(run);
  process.stdout.write(
    `notesapp: migrations applied to ${databaseName(run.databaseUrl)} (${profile} profile)\n`,
  );
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'notesapp: the migration failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
