import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProfileDatabase,
  databaseName,
  isTestDatabaseName,
  migrationSecrets,
  migrationVariables,
  parseProfile,
  readDeploySecrets,
  readMigrationSecret,
  withCredentials,
  withDatabaseName,
} from './profiles.ts';

await test('databaseName: reads the selected database', () => {
  assert.equal(
    databaseName('postgres://user:secret@127.0.0.1:55432/notesapp_test'),
    'notesapp_test',
  );
});

await test('databaseName: decodes an escaped name', () => {
  assert.equal(
    databaseName('postgresql://host/notesapp_test%5Fabc'),
    'notesapp_test_abc',
  );
});

await test('databaseName: rejects another scheme', () => {
  assert.throws(() => databaseName('mysql://host/notesapp_test'), /scheme/);
});

await test('databaseName: rejects a URL without a database', () => {
  assert.throws(() => databaseName('postgres://host'), /names no database/);
});

await test('databaseName: rejects a value that is not a URL', () => {
  assert.throws(() => databaseName('not a url'), /not a valid URL/);
});

await test('isTestDatabaseName: accepts the disposable namespace', () => {
  assert.equal(isTestDatabaseName('notesapp_test'), true);
  assert.equal(isTestDatabaseName('notesapp_test_9f2a'), true);
});

await test('isTestDatabaseName: rejects an operator database', () => {
  assert.equal(isTestDatabaseName('notesapp'), false);
  assert.equal(isTestDatabaseName('production_notesapp_test'), false);
});

await test('assertProfileDatabase: accepts a test database for the test profile', () => {
  assertProfileDatabase('test', 'postgres://host/notesapp_test_1');
});

await test('assertProfileDatabase: refuses an operator database for the test profile', () => {
  assert.throws(
    () => assertProfileDatabase('test', 'postgres://host/notesapp'),
    /needs a database named notesapp_test/,
  );
});

await test('assertProfileDatabase: refuses a test database for the deploy profile', () => {
  assert.throws(
    () => assertProfileDatabase('deploy', 'postgres://host/notesapp_test_1'),
    /refuses the test database/,
  );
});

await test('assertProfileDatabase: accepts an operator database for the deploy profile', () => {
  assertProfileDatabase('deploy', 'postgres://host/notesapp');
});

await test('parseProfile: reads a separated value', () => {
  assert.equal(parseProfile(['--profile', 'test']), 'test');
});

await test('parseProfile: reads a joined value', () => {
  assert.equal(parseProfile(['--profile=deploy']), 'deploy');
});

await test('parseProfile: ignores the argument separator', () => {
  assert.equal(parseProfile(['--', '--profile', 'test']), 'test');
});

await test('parseProfile: requires a profile', () => {
  assert.throws(() => parseProfile([]), /--profile test or --profile deploy/);
});

await test('parseProfile: rejects an unknown profile', () => {
  assert.throws(
    () => parseProfile(['--profile', 'staging']),
    /--profile test or --profile deploy/,
  );
});

await test('parseProfile: rejects an unknown argument', () => {
  assert.throws(() => parseProfile(['--force']), /unknown argument/);
});

await test('connection URL helpers: replaces the database name', () => {
  assert.equal(
    databaseName(
      withDatabaseName(
        'postgres://user:secret@127.0.0.1:55432/notesapp_test',
        'notesapp_test_abc',
      ),
    ),
    'notesapp_test_abc',
  );
});

await test('connection URL helpers: replaces the credentials', () => {
  const url = withCredentials(
    'postgres://notesapp_migrate:one@127.0.0.1:55432/notesapp_test',
    'notesapp_app',
    'two:three@four',
  );
  const parsed = new URL(url);
  assert.equal(decodeURIComponent(parsed.username), 'notesapp_app');
  assert.equal(decodeURIComponent(parsed.password), 'two:three@four');
  assert.equal(databaseName(url), 'notesapp_test');
});

/** A reader of files that knows a fixed set of paths. */
function filesOf(
  files: Readonly<Record<string, string>>,
): (path: string) => Promise<string> {
  return (path) => {
    const text = files[path];
    return text === undefined
      ? Promise.reject(new Error(`ENOENT: no such file, open '${path}'`))
      : Promise.resolve(text);
  };
}

await test('migration secrets: each comes from its variable or its file', async () => {
  // Record 0207: a platform that mounts no file sets the variable, and
  // Compose mounts the file.
  for (const name of migrationSecrets) {
    const fileName = `${name}_FILE`;
    const read = filesOf({ '/run/secrets/one': ' value-from-file \n' });
    assert.equal(
      await readMigrationSecret({ [name]: ' as written ' }, name, read),
      ' as written ',
    );
    assert.equal(
      await readMigrationSecret({ [fileName]: '/run/secrets/one' }, name, read),
      'value-from-file',
    );
    // An empty value is a value that is not set.
    assert.equal(
      await readMigrationSecret(
        { [name]: '', [fileName]: '/run/secrets/one' },
        name,
        read,
      ),
      'value-from-file',
    );
  }
});

await test('migration secrets: both forms, no form, and a bad file stop the command', async () => {
  const read = filesOf({
    '/run/secrets/one': 'value-from-file',
    '/run/secrets/empty': ' \n',
  });
  for (const name of migrationSecrets) {
    const fileName = `${name}_FILE`;
    const refusals: readonly (readonly [Record<string, string>, string])[] = [
      [
        { [name]: 'secret-value', [fileName]: '/run/secrets/one' },
        `notesapp: set either ${name} or ${fileName}, not both.`,
      ],
      [{}, `notesapp: set ${name} or ${fileName}.`],
      [{ [name]: '', [fileName]: '' }, `notesapp: set ${name} or ${fileName}.`],
      [
        { [fileName]: '/run/secrets/empty' },
        `notesapp: ${fileName}: the file is empty.`,
      ],
      [
        { [fileName]: '/run/secrets/missing' },
        `notesapp: ${fileName}: the file cannot be read.`,
      ],
    ];
    for (const [environment, message] of refusals)
      await assert.rejects(
        readMigrationSecret(environment, name, read),
        (error: unknown) =>
          error instanceof Error &&
          error.message === message &&
          !error.message.includes('secret-value'),
        `${name} ${JSON.stringify(environment)}`,
      );
  }
});

await test('migration secrets: the deploy profile reads the names of the image', async () => {
  // The runtime address of a container that migrates and serves is never
  // the migration address, so the profile reads no setting of the server.
  const secrets = await readDeploySecrets(
    {
      NOTESAPP_DATABASE_URL: 'postgres://runtime@db/notesapp',
      NOTESAPP_DATABASE_URL_FILE: '/run/secrets/runtime_database_url',
      NOTESAPP_MIGRATION_DATABASE_URL: 'postgres://migrate@db/notesapp',
      NOTESAPP_RUNTIME_PASSWORD_FILE: '/run/secrets/runtime',
      NOTESAPP_AUTH_PASSWORD: 'identity-password',
    },
    filesOf({ '/run/secrets/runtime': 'runtime-password\n' }),
  );
  assert.deepEqual(secrets, {
    databaseUrl: 'postgres://migrate@db/notesapp',
    runtimePassword: 'runtime-password',
    authPassword: 'identity-password',
  });
  assert.deepEqual(migrationVariables, [
    'NOTESAPP_MIGRATION_DATABASE_URL',
    'NOTESAPP_MIGRATION_DATABASE_URL_FILE',
    'NOTESAPP_RUNTIME_PASSWORD',
    'NOTESAPP_RUNTIME_PASSWORD_FILE',
    'NOTESAPP_AUTH_PASSWORD',
    'NOTESAPP_AUTH_PASSWORD_FILE',
  ]);
});
