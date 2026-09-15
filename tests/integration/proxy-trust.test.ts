/**
 * One decider of the client address, over a real listening server.
 *
 * A forwarded header is a claim of the caller. The server believes it only
 * when `NOTESAPP_TRUSTED_PROXIES` names the sender, and every part of the
 * server then reads that one answer. See
 * [decision 0043](../../docs/decisions/0043-one-decider-of-the-client-address.md).
 */
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
import { startTestServer } from './support/server.ts';

/** The HTTP response of a generated call, or a clear test failure. */
function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

/** A listening server, and the client addresses that it believed. */
async function startWithTrust(trusted?: string): Promise<{
  close: () => Promise<void>;
  addresses: string[];
}> {
  const addresses: string[] = [];
  const server = await startTestServer({
    environment: {
      NOTESAPP_RATE_LIMIT_WINDOW_S: '60',
      NOTESAPP_RATE_LIMIT_MAX: '2',
      ...(trusted === undefined ? {} : { NOTESAPP_TRUSTED_PROXIES: trusted }),
    },
    // The hook reads the same field that the attempt limit keys on, so the
    // test observes the answer of the server and not a copy of it.
    onApp: (app) => {
      app.addHook('onRequest', async (request) => {
        addresses.push(request.ip);
      });
    },
  });
  configureClient(server.baseUrl, undefined);
  return { close: server.close, addresses };
}

await test('a forwarded address is ignored while no proxy is trusted', async () => {
  const server = await startWithTrust();
  try {
    const answer = await getSetupStatus({
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    assert.equal(responseOf(answer.response).status, 200);
    assert.deepEqual(server.addresses, ['127.0.0.1']);
  } finally {
    await server.close();
  }
});

await test('a named proxy moves the client address', async () => {
  const server = await startWithTrust('127.0.0.1');
  try {
    await getSetupStatus({ headers: { 'x-forwarded-for': '203.0.113.7' } });
    assert.deepEqual(server.addresses, ['203.0.113.7']);
  } finally {
    await server.close();
  }
});

await test('an entry in front of the named proxy is dropped', async () => {
  // The caller writes the leftmost entry, and the proxy appends the address it
  // saw. The server stops at the first hop that it does not trust.
  const server = await startWithTrust('127.0.0.1');
  try {
    await getSetupStatus({
      headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' },
    });
    assert.deepEqual(server.addresses, ['203.0.113.7']);
  } finally {
    await server.close();
  }
});

await test('the attempt limit counts one client while no proxy is trusted', async () => {
  const server = await startWithTrust();
  try {
    const statuses: number[] = [];
    for (const address of ['203.0.113.7', '203.0.113.8', '203.0.113.9']) {
      const answer = await getSetupStatus({
        headers: { 'x-forwarded-for': address },
      });
      statuses.push(responseOf(answer.response).status);
    }
    assert.deepEqual(statuses, [200, 200, 429]);
  } finally {
    await server.close();
  }
});

await test('the attempt limit counts each client behind a named proxy', async () => {
  const server = await startWithTrust('127.0.0.1');
  try {
    const statuses: number[] = [];
    for (const address of ['203.0.113.7', '203.0.113.8', '203.0.113.9']) {
      const answer = await getSetupStatus({
        headers: { 'x-forwarded-for': address },
      });
      statuses.push(responseOf(answer.response).status);
    }
    assert.deepEqual(statuses, [200, 200, 200]);
  } finally {
    await server.close();
  }
});

await test('the identity routes count one client for a forged header', async () => {
  // The protocol library reads the client address from the header that the
  // adapter writes, so a caller that names a new address for each attempt
  // still meets the same attempt limit.
  const database = await createDisposableDatabase();
  const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-proxy-trust-'));
  const config = loadServerConfig({
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'proxy-trust-test-secret-value-0123456789',
    NOTESAPP_LOG_LEVEL: 'silent',
    NOTESAPP_MAX_BODY_BYTES: '1048576',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
    NOTESAPP_RATE_LIMIT_WINDOW_S: '60',
    NOTESAPP_RATE_LIMIT_MAX: '2',
  });
  const app = await createApp(config);
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string')
      throw new Error('The proxy trust test server did not bind a TCP port.');
    configureClient(`http://127.0.0.1:${String(address.port)}`, undefined);
    const statuses: number[] = [];
    for (const forged of ['203.0.113.7', '203.0.113.8', '203.0.113.9']) {
      const answer = await signInWithPassword({
        headers: { origin: config.origin, 'x-forwarded-for': forged },
        body: {
          email: 'missing@notes.invalid',
          password: 'missing-password',
        },
      });
      statuses.push(responseOf(answer.response).status);
    }
    assert.deepEqual(statuses, [401, 401, 429]);
  } finally {
    await app.close();
    await database.destroy();
    await rm(storageRoot, { recursive: true, force: true });
  }
});
