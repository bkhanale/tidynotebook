import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigError, loadServerConfig } from './config.ts';

const valid: Record<string, string> = {
  NOTESAPP_ORIGIN: 'http://127.0.0.1',
  NOTESAPP_DATABASE_URL: 'postgres://notesapp:notesapp@127.0.0.1:5432/notesapp',
  NOTESAPP_AUTH_DATABASE_URL:
    'postgres://notesapp_auth:notesapp_auth@127.0.0.1:5432/notesapp',
  NOTESAPP_STORAGE_ROOT: '/var/lib/notesapp',
  NOTESAPP_AUTH_SECRET: 'test-secret-value-for-integration-checks',
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
  assert.deepEqual(config.servedOrigins, ['http://127.0.0.1']);
  assert.equal(config.logLevel, 'warn');
  assert.equal(config.limits.bodyBytes, 1048576);
  assert.equal(config.limits.headerBytes, 16384);
  assert.equal(config.limits.requestTimeoutMs, 5000);
  assert.deepEqual(config.rateLimit, { windowSeconds: 60, max: 100 });
});

await test('the public route rate limit is explicit and configurable', () => {
  assert.deepEqual(
    loadServerConfig(
      environment({
        NOTESAPP_RATE_LIMIT_WINDOW_S: '30',
        NOTESAPP_RATE_LIMIT_MAX: '8',
      }),
    ).rateLimit,
    { windowSeconds: 30, max: 8 },
  );
});

await test('the identity connection must use its own role', () => {
  assert.throws(
    () =>
      loadServerConfig(
        environment({
          NOTESAPP_AUTH_DATABASE_URL: valid.NOTESAPP_DATABASE_URL,
        }),
      ),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.issues.some((issue) =>
        issue.includes('NOTESAPP_AUTH_DATABASE_URL'),
      ),
  );
});

await test('a mail transport needs a sender address', () => {
  assert.throws(
    () =>
      loadServerConfig(
        environment({ NOTESAPP_SMTP_URL: 'smtps://mail.invalid' }),
      ),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.issues.some((issue) => issue.includes('NOTESAPP_MAIL_FROM')),
  );
  assert.equal(loadServerConfig(valid).mail, null);
});

await test('the stop of the server has a default and takes a named value', () => {
  assert.deepEqual(loadServerConfig(valid).shutdown, {
    gracePeriodMs: 5000,
    deadlineMs: 20000,
  });
  // A deployment with no proxy in front reports the stop and closes at once.
  assert.deepEqual(
    loadServerConfig(
      environment({
        NOTESAPP_SHUTDOWN_GRACE_MS: '0',
        NOTESAPP_SHUTDOWN_DEADLINE_MS: '9000',
      }),
    ).shutdown,
    { gracePeriodMs: 0, deadlineMs: 9000 },
  );
});

await test('the stop deadline must be longer than the grace period', () => {
  assert.throws(
    () =>
      loadServerConfig(
        environment({
          NOTESAPP_SHUTDOWN_GRACE_MS: '9000',
          NOTESAPP_SHUTDOWN_DEADLINE_MS: '9000',
        }),
      ),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.issues.some((issue) =>
        issue.includes('NOTESAPP_SHUTDOWN_DEADLINE_MS'),
      ),
  );
  assert.throws(
    () => loadServerConfig(environment({ NOTESAPP_SHUTDOWN_GRACE_MS: '-1' })),
    (error: unknown) => error instanceof ConfigError,
  );
});

await test('the session lifetime has a safe default', () => {
  assert.equal(loadServerConfig(valid).sessionMaxAgeSeconds, 604800);
});

await test('the log level defaults to info when it is absent', () => {
  assert.equal(
    loadServerConfig(environment({ NOTESAPP_LOG_LEVEL: undefined })).logLevel,
    'info',
  );
});

await test('an absent additional list serves the canonical origin only', () => {
  const config = loadServerConfig(
    environment({ NOTESAPP_ORIGIN: 'https://Notes.Example.com:8443' }),
  );
  assert.equal(config.origin, 'https://notes.example.com:8443');
  assert.deepEqual(config.servedOrigins, ['https://notes.example.com:8443']);
});

await test('an additional origin joins the served list', () => {
  assert.deepEqual(
    loadServerConfig(
      environment({
        NOTESAPP_ORIGIN: 'http://127.0.0.1',
        NOTESAPP_ADDITIONAL_ORIGINS: 'http://localhost,http://[::1]:3000',
      }),
    ).servedOrigins,
    ['http://127.0.0.1', 'http://localhost', 'http://[::1]:3000'],
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

await test('a malformed additional origin stops startup', () => {
  assert.throws(
    () =>
      loadServerConfig(
        environment({ NOTESAPP_ADDITIONAL_ORIGINS: 'notes.test' }),
      ),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.issues.some((issue) =>
        issue.startsWith('NOTESAPP_ADDITIONAL_ORIGINS:'),
      ),
  );
});

await test('a removed host list stops startup and names the values to set', () => {
  // A deployment of 0.1 named its second host here. Dropping the value in
  // silence would narrow what the installation serves, and the person who runs
  // it would find out at the next sign-in.
  assert.throws(
    () =>
      loadServerConfig(
        environment({ NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost' }),
      ),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.issues.length === 1 &&
      error.issues.every(
        (issue) =>
          issue.startsWith('NOTESAPP_ALLOWED_HOSTS:') &&
          issue.includes('NOTESAPP_ADDITIONAL_ORIGINS'),
      ),
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
