/**
 * The attempt limit of the identity routes outside production.
 *
 * The identity library answers a request with no usable client address with
 * the loopback address when `NODE_ENV` names a development or a test run, so
 * every such request of that run shares one attempt bucket. The adapter gives
 * the library the one client address of this server on every request (record
 * 0043), so that fallback must stay unreachable. This file proves it in a
 * development run, where the fallback is live.
 *
 * The library reads `NODE_ENV` once, when it loads. So this file sets it
 * before it loads the server, and the test runner gives each file its own
 * process.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { configureClient, signInWithPassword } from '@notesapp/api-client';
import { createDisposableDatabase } from './support/database.ts';

process.env['NODE_ENV'] = 'development';
const { createApp, loadServerConfig } = await import('@notesapp/server');

/** The HTTP response of a generated call, or a clear test failure. */
function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

await test('two callers hold two attempt buckets outside production', async () => {
  const database = await createDisposableDatabase();
  const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-attempts-'));
  const config = loadServerConfig({
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'identity-attempts-test-secret-0123456789',
    NOTESAPP_LOG_LEVEL: 'silent',
    NOTESAPP_MAX_BODY_BYTES: '1048576',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
    NOTESAPP_RATE_LIMIT_WINDOW_S: '60',
    NOTESAPP_RATE_LIMIT_MAX: '2',
    // The test client and the server share one host, so the loopback proxy
    // is what gives the two callers two addresses.
    NOTESAPP_TRUSTED_PROXIES: 'loopback',
  });
  const app = await createApp(config);
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string')
      throw new Error('The attempt test server did not bind a TCP port.');
    configureClient(`http://127.0.0.1:${String(address.port)}`, undefined);
    /** One failed sign-in from one client address, as its status. */
    const attempt = async (client: string): Promise<number> => {
      const answer = await signInWithPassword({
        headers: { origin: config.origin, 'x-forwarded-for': client },
        body: {
          email: 'missing@notes.invalid',
          password: 'missing-password',
        },
      });
      return responseOf(answer.response).status;
    };

    const first = [];
    for (let index = 0; index < 3; index += 1)
      first.push(await attempt('203.0.113.7'));
    assert.deepEqual(first, [401, 401, 429]);
    // A shared bucket would refuse this caller too, because the first one
    // used it up.
    assert.equal(await attempt('203.0.113.8'), 401);
  } finally {
    await app.close();
    await database.destroy();
    await rm(storageRoot, { recursive: true, force: true });
  }
});
