/**
 * The notice coordinator of a device against a real server and a real
 * local store (records 0124, 0130).
 *
 * The device runs the parts that the web tab runs: the lease keeper, the
 * coordinator over the PartySocket transport, and an engine on the lease gate.
 * The poll interval of the engine is one hour, so after its first pass only a
 * notice or a local queue change starts a pass. What this file proves arrives
 * through the stream, and each wait ends on a condition of the local store or
 * of the server.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IDBFactory, IDBKeyRange as FakeKeyRange } from 'fake-indexeddb';
import {
  commitChangeset,
  configureClient,
  connectSyncNotices,
  createOwner,
  encodeSyncNoticesMessage,
  getAccount,
  getFile,
  getSyncProtocol,
  listWorkspaces,
  signInWithPassword,
  syncNoticesProtocol,
} from '@notesapp/api-client';
import { createApp, loadServerConfig } from '@notesapp/server';
import { openCoordination } from '@notesapp/storage-server';
import { openLocalStore } from '@notesapp/storage-browser';
import {
  createLeaseKeeper,
  createNote,
  createNoticeCoordinator,
  createSyncEngine,
  engineInterval,
  timerSchedule,
  type Draft,
  type LocalStore,
} from '@notesapp/sync';
import { createDisposableDatabase, openSession } from './support/database.ts';
import { firstSave } from './support/documents.ts';
import { socketClassWith } from './support/notices.ts';

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

/** Waits until a condition holds, failing loudly after a long bound. */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  detail: string,
): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > 20_000)
      throw new Error(`the notice test stalled while waiting: ${detail}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const origin = 'http://127.0.0.1';
const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-notices-device-'));
const config = loadServerConfig({
  NOTESAPP_ORIGIN: origin,
  NOTESAPP_DATABASE_URL: database.runtimeUrl,
  NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
  NOTESAPP_STORAGE_ROOT: storageRoot,
  NOTESAPP_AUTH_SECRET: 'notices-device-test-secret-0123456789abcdef',
  NOTESAPP_LOG_LEVEL: 'silent',
  NOTESAPP_MAX_BODY_BYTES: '4194304',
  NOTESAPP_MAX_HEADER_BYTES: '16384',
  NOTESAPP_REQUEST_TIMEOUT_MS: '60000',
  NOTESAPP_SYNC_NOTICES: 'on',
});
const coordination = openCoordination(database.runtimeUrl, { poolSize: 1 });
await coordination.setNoticesPublishing(true);
const app = await createApp(config);
await app.listen({ host: '127.0.0.1', port: 0 });
const address: string | AddressInfo | null = app.server.address();
if (address === null || typeof address === 'string')
  throw new Error('The test server did not bind a TCP port.');
const baseUrl = `http://127.0.0.1:${String(address.port)}`;
configureClient(baseUrl, undefined);

const ownerEmail = 'notices-device@notes.invalid';
const ownerPassword = 'owner-password-123456';
const made = await createOwner({
  headers: { origin },
  body: { email: ownerEmail, password: ownerPassword },
});
assert.equal(responseOf(made.response).status, 201);
const signed = await signInWithPassword({
  headers: { origin },
  body: { email: ownerEmail, password: ownerPassword },
});
const cookie = cookieHeader(responseOf(signed.response).headers.getSetCookie());
const headers = { origin, cookie };
const accountId = (await getAccount({ headers })).data?.accountId ?? '';
const workspaceId =
  (await listWorkspaces({ headers })).data?.workspaces[0]?.workspaceId ?? '';

const store: LocalStore = await openLocalStore('https://notes.test', {
  indexedDB: new IDBFactory(),
  IDBKeyRange: FakeKeyRange,
  databaseName: 'notesapp-notices-device',
  deviceId: 'device-notices',
});

// The tab of the device: one lease keeper, one coordinator, one engine.
const keeper = createLeaseKeeper(store, { ownerId: 'tab-1', ttlMs: 30_000 });
const wakes = new Map<string, () => void>();
/** How many notices named a workspace, which only the stream can raise. */
let notified = 0;
const coordinator = createNoticeCoordinator(accountId, {
  keeper,
  offered: async () =>
    ((await getSyncProtocol()).data?.notificationProtocols ?? []).includes(
      syncNoticesProtocol,
    ),
  open: (handlers) =>
    connectSyncNotices(baseUrl, handlers, {
      socketClass: socketClassWith(headers),
    }),
  encode: (generation, workspaceIds) =>
    encodeSyncNoticesMessage({
      kind: 'subscribe',
      generation,
      workspaceIds: [...workspaceIds],
    }),
  wake: (id) => {
    notified += 1;
    wakes.get(id)?.();
  },
  wakeAll: () => {
    for (const wake of wakes.values()) wake();
  },
  sessionEnded: () => {},
  schedule: timerSchedule,
});
const hourMs = 60 * 60_000;
const engine = createSyncEngine(store, accountId, workspaceId, {
  ownerId: 'tab-1',
  headers: () => headers,
  lease: keeper.gate,
  interval: () => engineInterval(coordinator.healthy(), hourMs, Math.random),
});
wakes.set(workspaceId, () => {
  engine.requestSync();
});
keeper.onChange(() => {
  engine.requestSync();
});
// A local queue change wakes the engine, with or without the stream.
const stopQueue = store.subscribe((change) => {
  if (change.kind === 'queue') engine.requestSync();
});
const controller = new AbortController();
const running = engine.run(controller.signal);
coordinator.want([workspaceId]);
keeper.start();
coordinator.start();

/** Whether the local cursor reached one server cursor. */
async function reached(cursor: string): Promise<boolean> {
  const local = await store.readCursor(accountId, workspaceId);
  return local !== null && BigInt(local) >= BigInt(cursor);
}

/** Commits `count` new notes from another device and answers the cursor. */
async function commitElsewhere(folder: string, count: number): Promise<string> {
  const clientTime = new Date().toISOString();
  const revisions = Array.from({ length: count }, (_, index) => ({
    revisionId: randomUUID(),
    fileId: randomUUID(),
    parents: [],
    path: `${folder}/note-${String(index)}.md`,
    deleted: false,
    content: {
      kind: 'markdown' as const,
      document: firstSave(`# Note ${String(index)}\n`),
    },
    clientTime,
  }));
  const committed = await commitChangeset({
    headers,
    path: { workspaceId },
    body: {
      mutationId: randomUUID(),
      deviceId: 'other-device',
      expectedHeads: Object.fromEntries(
        revisions.map((revision) => [revision.fileId, null]),
      ),
      revisions,
    },
  });
  assert.equal(committed.error, undefined, JSON.stringify(committed.error));
  return committed.data?.cursor ?? '';
}

await test('the device takes the lease, reads a snapshot and accepts its set', async () => {
  await waitFor(
    async () => (await store.readCursor(accountId, workspaceId)) !== null,
    'the first snapshot',
  );
  await waitFor(() => coordinator.healthy(), 'the accepted set');
  assert.ok(engineInterval(coordinator.healthy(), hourMs, () => 0) < hourMs);
  // One account and one tab hold one stream.
  const session = await openSession(database.migrationUrl);
  try {
    const rows = await session.query<{ held: number }>(
      'select count(*)::int as held from stream_reservations where account_id = $1',
      [accountId],
    );
    assert.equal(rows[0]?.held, 1);
  } finally {
    await session.close();
  }
});

await test('a commit of another device reaches this device through a notice', async () => {
  const before = notified;
  const cursor = await commitElsewhere('elsewhere', 1);
  await waitFor(() => notified > before, 'the notice');
  await waitFor(() => reached(cursor), 'the pull');
});

await test('a backlog of several pages drains to its end', async () => {
  // Three commits of sixty notes do not fit one page of a hundred records,
  // so the pass reads page after page until an empty one.
  await commitElsewhere('backlog-a', 60);
  await commitElsewhere('backlog-b', 60);
  const last = await commitElsewhere('backlog-c', 60);
  await waitFor(() => reached(last), 'the whole backlog');
});

/** A new local note in the queue, as the editor makes one. */
function draft(fileId: string, path: string): Draft {
  return {
    accountId,
    workspaceId,
    workingCopyId: randomUUID(),
    fileId,
    baseRevisionId: null,
    text: `# ${path}\n`,
    path,
    sequence: 1,
    deleted: false,
  };
}

await test('a local note is sent at once, and still is with the stream off', async () => {
  const first = randomUUID();
  await createNote(store, draft(first, 'local/first.md'));
  await waitFor(
    async () => (await store.pending(accountId, workspaceId)).length === 0,
    'the first send',
  );
  const sent = await getFile({ headers, path: { workspaceId, fileId: first } });
  assert.equal(responseOf(sent.response).status, 200);

  await coordination.setNoticesPublishing(false);
  await waitFor(() => !coordinator.healthy(), 'the stream stops');
  assert.equal(
    engineInterval(coordinator.healthy(), hourMs, () => 0),
    hourMs,
  );
  const second = randomUUID();
  await createNote(store, draft(second, 'local/second.md'));
  await waitFor(
    async () => (await store.pending(accountId, workspaceId)).length === 0,
    'the send without the stream',
  );
  const again = await getFile({
    headers,
    path: { workspaceId, fileId: second },
  });
  assert.equal(responseOf(again.response).status, 200);
});

// Teardown
coordinator.stop();
stopQueue();
controller.abort();
engine.stop();
await running;
await keeper.stop();
await store.close();
await app.close();
await coordination.close();
await rm(storageRoot, { recursive: true, force: true });
await database.destroy();
