import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigError, loadServerConfig } from './config.ts';

const valid: Record<string, string> = {
  NOTESAPP_ORIGIN: 'http://127.0.0.1',
  NOTESAPP_DATABASE_URL: 'postgres://notesapp:notesapp@127.0.0.1:5432/notesapp',
  NOTESAPP_STORAGE_ROOT: '/var/lib/notesapp',
  NOTESAPP_AUTH_SECRET: 'test-secret-value-for-integration-checks',
  NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost',
  NOTESAPP_LOG_LEVEL: 'warn',
  NOTESAPP_MAX_BODY_BYTES: '1048576',
  NOTESAPP_MAX_HEADER_BYTES: '16384',
  NOTESAPP_REQUEST_TIMEOUT_MS: '5000',
};

/** @param overrides values that replace or remove an entry. */
function environment(
  overrides: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return { ...valid, ...overrides };
}

await test('a complete environment produces a configuration', () => {
  const config = loadServerConfig(valid);
  assert.equal(config.origin, 'http://127.0.0.1');
  assert.deepEqual(config.allowedHosts, ['127.0.0.1', 'localhost']);
  assert.equal(config.logLevel, 'warn');
  assert.equal(config.limits.bodyBytes, 1048576);
  assert.equal(config.limits.headerBytes, 16384);
  assert.equal(config.limits.requestTimeoutMs, 5000);
});

await test('the log level defaults to info when it is absent', () => {
  assert.equal(
    loadServerConfig(environment({ NOTESAPP_LOG_LEVEL: undefined })).logLevel,
    'info',
  );
});

await test('a bracketed IPv6 entry is an allowed host', () => {
  assert.deepEqual(
    loadServerConfig(
      environment({ NOTESAPP_ALLOWED_HOSTS: '[::1],notes.test' }),
    ).allowedHosts,
    ['[::1]', 'notes.test'],
  );
});

await test('a missing variable stops startup', () => {
  assert.throws(
    () => loadServerConfig(environment({ NOTESAPP_ORIGIN: undefined })),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.issues.some((issue) => issue.includes('NOTESAPP_ORIGIN')),
  );
});

await test('an empty variable stops startup', () => {
  assert.throws(
    () => loadServerConfig(environment({ NOTESAPP_AUTH_SECRET: '' })),
    ConfigError,
  );
});

await test('a short authentication secret stops startup', () => {
  assert.throws(
    () => loadServerConfig(environment({ NOTESAPP_AUTH_SECRET: 'short' })),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.issues.some((issue) =>
        issue.includes('/NOTESAPP_AUTH_SECRET: must NOT have fewer than 32'),
      ),
  );
});

await test('a malformed host list stops startup', () => {
  assert.throws(
    () =>
      loadServerConfig(
        environment({ NOTESAPP_ALLOWED_HOSTS: 'notes.test,bad host' }),
      ),
    ConfigError,
  );
});

await test('an unknown log level stops startup', () => {
  assert.throws(
    () => loadServerConfig(environment({ NOTESAPP_LOG_LEVEL: 'chatty' })),
    ConfigError,
  );
});

await test('a non numeric limit stops startup', () => {
  assert.throws(
    () => loadServerConfig(environment({ NOTESAPP_MAX_BODY_BYTES: '0' })),
    ConfigError,
  );
});

await test('a configuration error never repeats a rejected value', () => {
  try {
    loadServerConfig(environment({ NOTESAPP_AUTH_SECRET: 'super-secret' }));
    assert.fail('the short secret was accepted');
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    assert.equal(error.message.includes('super-secret'), false);
  }
});
