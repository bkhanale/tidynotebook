/** Public setup and authentication routes apply one explicit attempt limit. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  configureClient,
  getSetupStatus,
  signInWithPassword,
} from '@notesapp/api-client';
import { createApp, loadServerConfig } from '@notesapp/server';
import { createDisposableDatabase } from './support/database.ts';

/** The HTTP response of a generated call, or a clear test failure. */
function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-rate-limit-'));
const config = loadServerConfig({
  NOTESAPP_ORIGIN: 'http://127.0.0.1',
  NOTESAPP_DATABASE_URL: database.runtimeUrl,
  NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
  NOTESAPP_STORAGE_ROOT: storageRoot,
  NOTESAPP_AUTH_SECRET: 'rate-limit-test-secret-value-0123456789',
  NOTESAPP_ADDITIONAL_ORIGINS: 'http://localhost',
  NOTESAPP_LOG_LEVEL: 'silent',
  NOTESAPP_MAX_BODY_BYTES: '1048576',
  NOTESAPP_MAX_HEADER_BYTES: '16384',
  NOTESAPP_REQUEST_TIMEOUT_MS: '5000',
  NOTESAPP_RATE_LIMIT_WINDOW_S: '60',
  NOTESAPP_RATE_LIMIT_MAX: '2',
});
const app = await createApp(config);
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (address === null || typeof address === 'string')
  throw new Error('The rate limit test server did not bind a TCP port.');
configureClient(`http://127.0.0.1:${String(address.port)}`, undefined);

await test('the setup routes return 429 after the configured limit', async () => {
  const first = await getSetupStatus();
  const second = await getSetupStatus();
  const limited = await getSetupStatus();

  assert.equal(responseOf(first.response).status, 200);
  assert.equal(responseOf(second.response).status, 200);
  assert.equal(responseOf(limited.response).status, 429);
  assert.equal(
    typeof limited.error === 'object' &&
      limited.error !== null &&
      'code' in limited.error
      ? limited.error.code
      : null,
    'rate_limited',
  );
});

await test('the authentication routes return 429 after the configured limit', async () => {
  const body = {
    email: 'missing@notes.invalid',
    password: 'missing-password',
  };
  const first = await signInWithPassword({
    headers: { origin: config.origin },
    body,
  });
  const second = await signInWithPassword({
    headers: { origin: config.origin },
    body,
  });
  const limited = await signInWithPassword({
    headers: { origin: config.origin },
    body,
  });

  assert.equal(responseOf(first.response).status, 401);
  assert.equal(responseOf(second.response).status, 401);
  assert.equal(responseOf(limited.response).status, 429);
});

await app.close();
await database.destroy();
await rm(storageRoot, { recursive: true, force: true });
