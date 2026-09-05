/**
 * Migration profiles and their database guards.
 *
 * The migration command requires an explicit profile, so no default can point
 * a developer command at an operator database. Each profile reads its own
 * configuration source and refuses a database whose name belongs to the other
 * profile.
 */

/** The two migration profiles. A caller must name one. */
export type MigrationProfile = 'test' | 'deploy';

/** The prefix that marks a disposable test database. */
export const testDatabasePrefix = 'notesapp_test';

/** The name of the database that a PostgreSQL connection URL selects. */
export function databaseName(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('notesapp: the database URL is not a valid URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('notesapp: the database URL must use the postgres scheme.');
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '') {
    throw new Error('notesapp: the database URL names no database.');
  }
  return name;
}

/** Whether the name marks a disposable test database. */
export function isTestDatabaseName(name: string): boolean {
  return name.startsWith(testDatabasePrefix);
}

/**
 * Rejects a database that does not belong to the profile.
 *
 * The test profile accepts only a `notesapp_test` database, so a test run
 * cannot migrate an operator database. The deployment profile rejects such a
 * name, so an operator command cannot be pointed at a throwaway database by a
 * stale environment value.
 */
export function assertProfileDatabase(
  profile: MigrationProfile,
  url: string,
): void {
  const name = databaseName(url);
  if (profile === 'test' && !isTestDatabaseName(name)) {
    throw new Error(
      `notesapp: the test profile needs a database named ${testDatabasePrefix}*; found ${name}.`,
    );
  }
  if (profile === 'deploy' && isTestDatabaseName(name)) {
    throw new Error(
      `notesapp: the deploy profile refuses the test database ${name}.`,
    );
  }
}

/**
 * Reads the profile from command arguments.
 *
 * Accepts `--profile test` and `--profile=test`. Any other argument, a missing
 * profile, or an unknown value is a usage error.
 */
export function parseProfile(argv: readonly string[]): MigrationProfile {
  let value: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--') continue;
    if (argument === '--profile') {
      const next = argv[index + 1];
      if (next === undefined) break;
      value = next;
      index += 1;
      continue;
    }
    if (argument.startsWith('--profile=')) {
      value = argument.slice('--profile='.length);
      continue;
    }
    throw new Error(`notesapp: unknown argument ${argument}.`);
  }
  if (value === 'test' || value === 'deploy') return value;
  throw new Error('notesapp: pass --profile test or --profile deploy.');
}

/** Replaces the database name of a connection URL. */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(name)}`;
  return parsed.toString();
}

/** Replaces the user and the password of a connection URL. */
export function withCredentials(
  url: string,
  user: string,
  password: string,
): string {
  const parsed = new URL(url);
  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}
