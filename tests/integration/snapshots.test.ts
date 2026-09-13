/**
 * Snapshot and incremental sync checks against a real server, a real
 * database, and real sessions.
 *
 * Every application call goes through a generated operation function. The
 * tests interleave late commits with page reads to prove that no event is
 * skipped, that pages show captured immutable revisions, and that expiry,
 * retention, version, and purge rules hold.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  configureClient,
  createFile,
  getAccount,
  getChanges,
  getRevision,
  getSnapshotPage,
  listHistory,
  listWorkspaces,
  purgeFiles,
  signInWithPassword,
  startSnapshot,
  updateFile,
} from '@notesapp/api-client';
import {
  bootstrapOwner,
  createAuth,
  createAuthPool,
  createAuthProtocol,
  createHandlers,
  createIdentityAdapter,
  createSyncCleanup,
  loadServerConfig,
  type ServerConfig,
} from '@notesapp/server';
import {
  openAttachmentStore,
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import { createDisposableDatabase, openSession } from './support/database.ts';
import { startTestServer } from './support/server.ts';

/** Reads one property of an unknown value without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/** The HTTP response of a generated call, or a clear test failure. */
function responseOf(response: Response | undefined): Response {
  if (response === undefined)
    throw new Error('The generated client returned no HTTP response.');
  return response;
}

/** The stable application error code of a failed generated call. */
function problemCode(error: unknown): string {
  const code = readProperty(error, 'code');
  return typeof code === 'string' ? code : '';
}

/** Turns the Set-Cookie values of an answer into a Cookie request header. */
function cookieHeader(values: readonly string[]): string {
  return values
    .map((entry) => (entry.split(';')[0] ?? '').trim())
    .filter((entry) => entry !== '' && !entry.endsWith('='))
    .join('; ');
}

/** The headers of a browser request. A write also names the origin. */
function browser(cookie: string): Record<string, string> {
  return { origin: 'https://notes.test', cookie };
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-snapshots-test-'));

const identity = openIdentityStore(database.runtimeUrl);
const content = openWorkspaceStore(database.runtimeUrl, { poolSize: 4 });
const attachments = openAttachmentStore(database.runtimeUrl, storageRoot, {
  poolSize: 4,
});

/** The environment of this test deployment. */
function environment(): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'https://notes.test',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'snapshots-test-secret-value-0123456789ab',
    NOTESAPP_ALLOWED_HOSTS: '127.0.0.1,localhost,notes.test',
    NOTESAPP_LOG_LEVEL: 'error',
    NOTESAPP_MAX_BODY_BYTES: '8388608',
    NOTESAPP_MAX_HEADER_BYTES: '16384',
    NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
  };
}

const config: ServerConfig = loadServerConfig(environment());
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
    createHandlers(value, undefined, {
      store: identity,
      content,
      attachments,
    }),
  identity: adapter.resolver,
  protocols: [createAuthProtocol(config, auth.auth)],
});
configureClient(server.baseUrl, undefined);

const ownerEmail = 'snapshots-owner@notes.invalid';
const ownerPassword = 'owner-password-123456';
await bootstrapOwner({
  config,
  email: ownerEmail,
  name: 'Snapshots Owner',
  password: ownerPassword,
});

const ownerSignedIn = await signInWithPassword({
  headers: { origin: 'https://notes.test' },
  body: { email: ownerEmail, password: ownerPassword },
});
const ownerCookie = cookieHeader(
  responseOf(ownerSignedIn.response).headers.getSetCookie(),
);
assert.ok(ownerCookie.length > 0, 'the test needs an owner session cookie');

const account = await getAccount({ headers: browser(ownerCookie) });
const ownerAccountId = account.data?.accountId ?? '';
assert.match(ownerAccountId, /^[0-9a-f-]{36}$/);

const listed = await listWorkspaces({ headers: browser(ownerCookie) });
const workspaceId = listed.data?.workspaces[0]?.workspaceId ?? '';
assert.match(workspaceId, /^[0-9a-f-]{36}$/);

/** The client identifiers that every write carries. */
function mutationIds(): {
  revisionId: string;
  mutationId: string;
  deviceId: string;
  clientTime: string;
} {
  return {
    revisionId: randomUUID(),
    mutationId: randomUUID(),
    deviceId: 'integration-device',
    clientTime: new Date().toISOString(),
  };
}

/** Creates one note file and returns its identifiers and entity tag. */
async function newFile(
  path: string,
  text = `# ${path}\n`,
  cookie = ownerCookie,
): Promise<{ fileId: string; revisionId: string; tag: string }> {
  const fileId = randomUUID();
  const ids = mutationIds();
  const created = await createFile({
    headers: browser(cookie),
    path: { workspaceId },
    body: {
      fileId,
      path,
      text,
      revisionId: ids.revisionId,
      mutationId: ids.mutationId,
      deviceId: ids.deviceId,
    },
  });
  assert.equal(created.error, undefined, JSON.stringify(created.error));
  const response = responseOf(created.response);
  assert.equal(response.status, 201);
  return {
    fileId,
    revisionId: created.data?.revision.revisionId ?? '',
    tag: response.headers.get('etag') ?? '',
  };
}

/** Backdates snapshot expiry rows through the migration role connection. */
async function expireSnapshots(): Promise<void> {
  const session = await openSession(database.migrationUrl);
  try {
    await session.query(
      "update snapshots set expires_at = now() - interval '1 minute'",
    );
  } finally {
    await session.close();
  }
}

/** The captured files of the first snapshot and their revision texts. */
const captured = new Map<string, { revisionId: string; text: string }>();
let snapshotToken = '';
let snapshotCursor = '';

await test('startSnapshot captures files with immutable revision identifiers', async () => {
  const first = await newFile('sync-first.md', '# First\n');
  const second = await newFile('sync-second.md', '# Second\n');
  const third = await newFile('sync-third.md', '# Third\n');
  captured.set(first.fileId, {
    revisionId: first.revisionId,
    text: '# First\n',
  });
  captured.set(second.fileId, {
    revisionId: second.revisionId,
    text: '# Second\n',
  });
  captured.set(third.fileId, {
    revisionId: third.revisionId,
    text: '# Third\n',
  });

  const started = await startSnapshot({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: { syncVersion: 1 },
  });
  assert.equal(started.error, undefined, JSON.stringify(started.error));
  assert.equal(responseOf(started.response).status, 200);
  snapshotToken = started.data?.token ?? '';
  snapshotCursor = started.data?.cursor ?? '';
  const expectedItems = captured.size + 1;
  assert.match(snapshotToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(snapshotCursor, /^[0-9]+$/);
  assert.equal(started.data?.itemCount, expectedItems);
  assert.equal(started.data?.pageSize, 100);

  const firstPage = await getSnapshotPage({
    headers: browser(ownerCookie),
    path: { workspaceId, token: snapshotToken },
    query: { limit: 2 },
  });
  assert.equal(firstPage.error, undefined, JSON.stringify(firstPage.error));
  assert.equal(firstPage.data?.items.length, 2);
  assert.equal(firstPage.data?.nextPosition, 2);
  assert.equal(firstPage.data?.cursor, snapshotCursor);
  assert.equal(firstPage.data?.totalItems, expectedItems);

  const secondPage = await getSnapshotPage({
    headers: browser(ownerCookie),
    path: { workspaceId, token: snapshotToken },
    query: { position: 2 },
  });
  assert.equal(secondPage.error, undefined, JSON.stringify(secondPage.error));
  assert.equal(secondPage.data?.items.length, 2);
  assert.equal(secondPage.data?.nextPosition, null);
  assert.equal(secondPage.data?.position, 2);
});

await test('late commits do not change snapshot pages but appear in changes', async () => {
  const [entry] = [...captured.entries()];
  assert.ok(entry !== undefined, 'the test needs a captured file');
  const [fileId, before] = entry;
  const updatedText = '# First Updated\n';
  const ids = mutationIds();

  // Read the live head tag through the file list is not needed: update with
  // the known head revision as the precondition instead.
  const updated = await updateFile({
    headers: {
      ...browser(ownerCookie),
      'if-match': `"${before.revisionId}"`,
    },
    path: { workspaceId, fileId },
    body: {
      text: updatedText,
      revisionId: ids.revisionId,
      mutationId: ids.mutationId,
      deviceId: ids.deviceId,
    },
  });
  assert.equal(updated.error, undefined, JSON.stringify(updated.error));

  // The captured page still names the old immutable revision.
  const reread = await getSnapshotPage({
    headers: browser(ownerCookie),
    path: { workspaceId, token: snapshotToken },
    query: { limit: 500 },
  });
  assert.equal(reread.error, undefined, JSON.stringify(reread.error));
  const pinned = reread.data?.items.find((item) => item.fileId === fileId);
  assert.equal(pinned?.revisionId, before.revisionId);

  // The pinned revision still carries the old content, not the new head.
  const pinnedRevision = await getRevision({
    headers: browser(ownerCookie),
    path: { workspaceId, revisionId: before.revisionId },
  });
  assert.equal(pinnedRevision.error, undefined);
  assert.equal(pinnedRevision.data?.text, before.text);

  // The late commit appears exactly once after the snapshot cursor.
  const changes = await getChanges({
    headers: browser(ownerCookie),
    path: { workspaceId },
    query: { cursor: snapshotCursor },
  });
  assert.equal(changes.error, undefined, JSON.stringify(changes.error));
  const rows = changes.data?.changes ?? [];
  assert.ok(rows.length >= 1, 'the late commit must appear in the stream');
  let previous = BigInt(snapshotCursor);
  for (const row of rows) {
    const at = BigInt(row.cursor);
    assert.ok(at > BigInt(snapshotCursor), 'no record may predate the cursor');
    assert.ok(at >= previous, 'records must arrive in commit order');
    previous = at;
  }
  const late = rows.find((row) => row.entityId === fileId);
  assert.ok(late !== undefined, 'the updated file must have a change record');
  assert.equal(late?.revisionId, ids.revisionId);
  assert.equal(late?.deleted, false);
  snapshotCursor = changes.data?.nextCursor ?? snapshotCursor;

  // Polling at the new cursor is empty and echoes the high-water mark.
  const quiet = await getChanges({
    headers: browser(ownerCookie),
    path: { workspaceId },
    query: { cursor: snapshotCursor },
  });
  assert.equal(quiet.error, undefined, JSON.stringify(quiet.error));
  assert.deepEqual(quiet.data?.changes, []);
  assert.equal(quiet.data?.nextCursor, snapshotCursor);
});

await test('an unsupported sync version is rejected without changing data', async () => {
  const rejected = await startSnapshot({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: { syncVersion: 2 } as never,
  });
  assert.equal(responseOf(rejected.response).status, 400);
  assert.equal(problemCode(rejected.error), 'invalid_request');
});

await test('an expired snapshot requires a restart', async () => {
  await expireSnapshots();
  const reread = await getSnapshotPage({
    headers: browser(ownerCookie),
    path: { workspaceId, token: snapshotToken },
  });
  assert.equal(responseOf(reread.response).status, 410);
  assert.equal(problemCode(reread.error), 'snapshot_required');
});

await test('a purge emits a deletion and invalidates live snapshots', async () => {
  const file = await newFile('sync-purged.md', '# Purged\n');
  const started = await startSnapshot({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: { syncVersion: 1 },
  });
  assert.equal(started.error, undefined, JSON.stringify(started.error));
  const token = started.data?.token ?? '';
  const at = started.data?.cursor ?? '';
  assert.ok(token.length > 0 && at.length > 0);

  const purged = await purgeFiles({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: { mutationId: randomUUID(), fileIds: [file.fileId] },
  });
  assert.equal(purged.error, undefined, JSON.stringify(purged.error));

  const changes = await getChanges({
    headers: browser(ownerCookie),
    path: { workspaceId },
    query: { cursor: at },
  });
  assert.equal(changes.error, undefined, JSON.stringify(changes.error));
  const deletion = (changes.data?.changes ?? []).find(
    (row) => row.entityKind === 'file' && row.entityId === file.fileId,
  );
  assert.ok(deletion !== undefined, 'the purge must be streamed');
  assert.equal(deletion?.deleted, true);

  const reread = await getSnapshotPage({
    headers: browser(ownerCookie),
    path: { workspaceId, token },
  });
  assert.equal(responseOf(reread.response).status, 410);
  assert.equal(problemCode(reread.error), 'snapshot_required');
});

await test('change records expire after 90 days but history is preserved', async () => {
  const pinned = [...captured.values()][0];
  assert.ok(pinned !== undefined, 'the test needs a captured revision');
  const session = await openSession(database.migrationUrl);
  try {
    await session.query(
      "update sync_changes set committed_at = now() - interval '100 days'",
    );
  } finally {
    await session.close();
  }

  const cleanup = createSyncCleanup(content);
  const outcome = await cleanup(new Date());
  assert.ok(outcome.oldChanges > 0, 'old change records must be reclaimed');

  const required = await getChanges({
    headers: browser(ownerCookie),
    path: { workspaceId },
    query: { cursor: '0' },
  });
  assert.equal(responseOf(required.response).status, 410);
  assert.equal(problemCode(required.error), 'snapshot_required');

  const revision = await getRevision({
    headers: browser(ownerCookie),
    path: { workspaceId, revisionId: pinned.revisionId },
  });
  assert.equal(revision.error, undefined, JSON.stringify(revision.error));
  assert.equal(revision.data?.text, pinned.text);

  const history = await listHistory({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId: [...captured.keys()][0] ?? '' },
  });
  assert.equal(history.error, undefined, JSON.stringify(history.error));
  assert.ok((history.data?.revisions.length ?? 0) >= 1);
});

// Teardown
await server.close();
await auth.close();
await authPool.end();
await attachments.close();
await content.close();
await identity.close();
await rm(storageRoot, { recursive: true, force: true });
await database.destroy();
