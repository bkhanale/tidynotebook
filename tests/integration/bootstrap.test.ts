/** The operator bootstrap creates the same first workspace as web setup. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  listFiles,
  listWorkspaces,
  signInWithPassword,
} from '@notesapp/api-client';
import { bootstrapOwner, createApp, loadServerConfig } from '@notesapp/server';
import { createDisposableDatabase } from './support/database.ts';

/** Keeps only the cookie pairs that a later generated operation sends. */
function cookieHeader(values: readonly string[]): string {
  return values
    .map((value) => (value.split(';')[0] ?? '').trim())
    .filter((value) => value !== '' && !value.endsWith('='))
    .join('; ');
}

await test('operator bootstrap seeds the welcome note', async () => {
  const database = await createDisposableDatabase();
  const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-bootstrap-test-'));
  const config = loadServerConfig({
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'bootstrap-test-secret-value-0123456789',
    NOTESAPP_ADDITIONAL_ORIGINS: 'http://localhost',
    NOTESAPP_LOG_LEVEL: 'silent',
    NOTESAPP_MAX_BODY_BYTES: '8388608',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
  });
  const email = 'bootstrap-owner@notes.invalid';
  const password = 'bootstrap-owner-password';
  let app: Awaited<ReturnType<typeof createApp>> | null = null;
  try {
    await bootstrapOwner({ config, email, name: 'Owner', password });
    app = await createApp(config);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string')
      throw new Error('The bootstrap test server did not bind a TCP port.');
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;

    const signedIn = await signInWithPassword({
      baseUrl,
      headers: { origin: config.origin },
      body: { email, password },
    });
    assert.equal(signedIn.error, undefined, JSON.stringify(signedIn.error));
    const response = signedIn.response;
    assert.ok(response !== undefined);
    const cookie = cookieHeader(response.headers.getSetCookie());
    assert.notEqual(cookie, '');

    const workspaces = await listWorkspaces({ baseUrl, headers: { cookie } });
    const workspaceId = workspaces.data?.workspaces[0]?.workspaceId;
    assert.ok(typeof workspaceId === 'string');
    const files = await listFiles({
      baseUrl,
      headers: { cookie },
      path: { workspaceId },
    });
    assert.equal(files.error, undefined, JSON.stringify(files.error));
    assert.deepEqual(
      files.data?.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        hasVersion: file.headRevisionId !== null,
      })),
      [
        {
          path: 'Welcome to Notesapp.md',
          kind: 'note',
          hasVersion: true,
        },
      ],
    );
  } finally {
    await app?.close();
    await database.destroy();
    await rm(storageRoot, { recursive: true, force: true });
  }
});
