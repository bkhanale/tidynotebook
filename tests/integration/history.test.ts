/** Explicit save history and restore checks against a real server. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  configureClient,
  createCheckpoint,
  createFile,
  getFile,
  listHistory,
  listWorkspaces,
  restoreRevision,
  signInWithPassword,
} from '@notesapp/api-client';
import { contentDigest } from '@notesapp/core';
import {
  bootstrapOwner,
  createAuth,
  createAuthPool,
  createAuthProtocol,
  createHandlers,
  createIdentityAdapter,
  loadServerConfig,
  type ServerConfig,
} from '@notesapp/server';
import {
  openAttachmentStore,
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import { createDisposableDatabase } from './support/database.ts';
import { startTestServer } from './support/server.ts';

function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

function cookieHeader(values: readonly string[]): string {
  return values
    .map((value) => (value.split(';')[0] ?? '').trim())
    .filter((value) => value !== '' && !value.endsWith('='))
    .join('; ');
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-history-test-'));
const environment = (): Record<string, string> => ({
  NOTESAPP_ORIGIN: 'https://notes.test',
  NOTESAPP_DATABASE_URL: database.runtimeUrl,
  NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
  NOTESAPP_STORAGE_ROOT: storageRoot,
  NOTESAPP_AUTH_SECRET: 'history-test-secret-value-0123456789abcd',
  NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost,notes.test',
  NOTESAPP_LOG_LEVEL: 'error',
  NOTESAPP_MAX_BODY_BYTES: '8388608',
  NOTESAPP_MAX_HEADER_BYTES: '16384',
  NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
});
const config: ServerConfig = loadServerConfig(environment());
const identity = openIdentityStore(database.runtimeUrl);
const content = openWorkspaceStore(database.runtimeUrl, { poolSize: 4 });
const attachments = openAttachmentStore(database.runtimeUrl, storageRoot, {
  poolSize: 4,
});
const authPool = createAuthPool(config);
const auth = createAuth(config, { mail: null }, authPool);
const adapter = createIdentityAdapter({
  auth: auth.auth,
  identity,
  origin: config.origin,
});
const server = await startTestServer({
  environment: environment(),
  handlers: (value) =>
    createHandlers(value, undefined, { store: identity, content, attachments }),
  identity: adapter.resolver,
  protocols: [createAuthProtocol(config, auth.auth)],
});
configureClient(server.baseUrl, undefined);

const email = 'history-owner@notes.invalid';
const password = 'owner-password-123456';
await bootstrapOwner({ config, email, name: 'History Owner', password });
const signedIn = await signInWithPassword({
  headers: { origin: 'https://notes.test' },
  body: { email, password },
});
const cookie = cookieHeader(
  responseOf(signedIn.response).headers.getSetCookie(),
);
const headers = { origin: 'https://notes.test', cookie };
const workspaces = await listWorkspaces({ headers });
const workspaceId = workspaces.data?.workspaces[0]?.workspaceId ?? '';

await test('each explicit save creates a restorable version', async () => {
  const fileId = randomUUID();
  const firstRevisionId = randomUUID();
  const created = await createFile({
    headers,
    path: { workspaceId },
    body: {
      fileId,
      path: 'versions.md',
      text: '# First\n',
      revisionId: firstRevisionId,
      mutationId: randomUUID(),
      deviceId: 'history-test',
    },
  });
  assert.equal(created.error, undefined, JSON.stringify(created.error));
  const tag = responseOf(created.response).headers.get('etag') ?? '';

  const secondText = '# Second\n';
  const secondRevisionId = randomUUID();
  const saved = await createCheckpoint({
    headers: { ...headers, 'if-match': tag },
    path: { workspaceId, fileId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'history-test',
      clientTime: new Date().toISOString(),
      revisionId: secondRevisionId,
      name: 'Manual save',
      content: {
        kind: 'markdown',
        digest: await contentDigest(secondText),
        text: secondText,
      },
    },
  });
  assert.equal(saved.error, undefined, JSON.stringify(saved.error));

  const history = await listHistory({
    headers,
    path: { workspaceId, fileId },
  });
  assert.deepEqual(
    history.data?.revisions.map((revision) => revision.revisionId),
    [secondRevisionId, firstRevisionId],
  );

  const restored = await restoreRevision({
    headers,
    path: { workspaceId, fileId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'history-test',
      clientTime: new Date().toISOString(),
      targetRevisionId: firstRevisionId,
      expectedHead: secondRevisionId,
      revisionId: randomUUID(),
      message: 'Restore first save',
    },
  });
  assert.equal(restored.error, undefined, JSON.stringify(restored.error));

  const current = await getFile({ headers, path: { workspaceId, fileId } });
  assert.equal(current.data?.head?.text, '# First\n');
  assert.equal(current.data?.head?.restoredFrom, firstRevisionId);
});

await server.close();
await auth.close();
await authPool.end();
await attachments.close();
await content.close();
await identity.close();
await rm(storageRoot, { recursive: true, force: true });
await database.destroy();
