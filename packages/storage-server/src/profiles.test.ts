import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProfileDatabase,
  databaseName,
  isTestDatabaseName,
  parseProfile,
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
