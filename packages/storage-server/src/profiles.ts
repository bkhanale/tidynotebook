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

/**
 * The three secrets of the deploy profile, by the names that the `migrate`
 * command of the image reads.
 *
 * Each one comes from its variable or from the file that its `_FILE`
 * variable names, never both (record 0207). A file suits Compose, which
 * mounts each secret, and the variable suits a platform that gives a service
 * variables only. None of them is a setting of the server, so a container
 * that only serves holds none (record 0202).
 */
export const migrationSecrets = [
  'NOTESAPP_MIGRATION_DATABASE_URL',
  'NOTESAPP_RUNTIME_PASSWORD',
  'NOTESAPP_AUTH_PASSWORD',
] as const;

/** The name of one secret of the deploy profile. */
export type MigrationSecret = (typeof migrationSecrets)[number];

/** Every variable that the deploy profile reads, each name once. */
export const migrationVariables: readonly string[] = migrationSecrets.flatMap(
  (name) => [name, `${name}_FILE`],
);

/** The secrets of one deploy run. */
export type DeploySecrets = {
  readonly databaseUrl: string;
  readonly runtimePassword: string;
  readonly authPassword: string;
};

/**
 * Reads one secret of the deploy profile.
 *
 * An empty value is a value that is not set. The variable is taken as it is
 * written, and a file loses the space around its value. Both forms, neither
 * form, a file that cannot be read and an empty file each stop the command.
 * Each message names the variable and never the value. `read` answers the
 * text of one file.
 */
export async function readMigrationSecret(
  environment: Readonly<Record<string, string | undefined>>,
  name: MigrationSecret,
  read: (path: string) => Promise<string>,
): Promise<string> {
  const fileName = `${name}_FILE`;
  const direct = environment[name] ?? '';
  const path = environment[fileName] ?? '';
  if (direct !== '' && path !== '')
    throw new Error(`notesapp: set either ${name} or ${fileName}, not both.`);
  if (direct !== '') return direct;
  if (path === '') throw new Error(`notesapp: set ${name} or ${fileName}.`);
  let text: string;
  try {
    text = await read(path);
  } catch {
    throw new Error(`notesapp: ${fileName}: the file cannot be read.`);
  }
  const value = text.trim();
  if (value === '')
    throw new Error(`notesapp: ${fileName}: the file is empty.`);
  return value;
}

/** Reads the three secrets of the deploy profile. */
export async function readDeploySecrets(
  environment: Readonly<Record<string, string | undefined>>,
  read: (path: string) => Promise<string>,
): Promise<DeploySecrets> {
  return {
    databaseUrl: await readMigrationSecret(
      environment,
      'NOTESAPP_MIGRATION_DATABASE_URL',
      read,
    ),
    runtimePassword: await readMigrationSecret(
      environment,
      'NOTESAPP_RUNTIME_PASSWORD',
      read,
    ),
    authPassword: await readMigrationSecret(
      environment,
      'NOTESAPP_AUTH_PASSWORD',
      read,
    ),
  };
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
