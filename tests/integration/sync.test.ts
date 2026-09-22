/**
 * Foreground sync checks against a real server, a real database, and real
 * sessions with a real IndexedDB-backed local store per device.
 *
 * Every application call goes through a generated operation function, and
 * every local record goes through `openLocalStore` over an isolated
 * `fake-indexeddb` backend. The engine under test is `createSyncEngine`
 * with its default operations, so these tests prove the wire behavior:
 * offline chains, lost answers, lease takeover, purge preservation, cursor
 * expiry, and server-side stale-save rebasing.
 */
import assert from 'node:assert/strict';
import {
  firstSave,
  saveForHead,
  useDocumentHeaders,
} from './support/documents.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IDBFactory, IDBKeyRange as FakeKeyRange } from 'fake-indexeddb';
import {
  commitChangeset,
  configureClient,
  createFile,
  getAccount,
  getFile,
  getRevision,
  listHistory,
  listWorkspaces,
  purgeFiles,
  restoreFile,
  signInWithPassword,
  updateFile,
} from '@notesapp/api-client';
import { contentDigest } from '@notesapp/core';
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
  createDocumentService,
  openAttachmentStore,
  openIdentityStore,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import { openLocalStore } from '@notesapp/storage-browser';
import {
  createSyncEngine,
  type Draft,
  type LocalStore,
  type SyncEngine,
  type SyncNotice,
} from '@notesapp/sync';
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
  return { origin: 'http://127.0.0.1', cookie };
}

/** The SHA-256 digest of UTF-8 Markdown, as the design defines it. */
function sha256hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-sync-test-'));

const identity = openIdentityStore(database.runtimeUrl);
const content = openWorkspaceStore(
  database.runtimeUrl,
  createDocumentService(),
  { poolSize: 4 },
);
const attachments = openAttachmentStore(database.runtimeUrl, storageRoot, {
  poolSize: 4,
});

/** The environment of this test deployment. */
function environment(): Record<string, string> {
  return {
    NOTESAPP_ORIGIN: 'http://127.0.0.1',
    NOTESAPP_DATABASE_URL: database.runtimeUrl,
    NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
    NOTESAPP_STORAGE_ROOT: storageRoot,
    NOTESAPP_AUTH_SECRET: 'sync-test-secret-value-0123456789abcdef',
    NOTESAPP_ADDITIONAL_ORIGINS: 'http://localhost',
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
  servedOrigins: config.servedOrigins,
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

const ownerEmail = 'sync-owner@notes.invalid';
const ownerPassword = 'owner-password-123456';
await bootstrapOwner({
  config,
  email: ownerEmail,
  name: 'Sync Owner',
  password: ownerPassword,
});

const ownerSignedIn = await signInWithPassword({
  headers: { origin: 'http://127.0.0.1' },
  body: { email: ownerEmail, password: ownerPassword },
});
const ownerCookie = cookieHeader(
  responseOf(ownerSignedIn.response).headers.getSetCookie(),
);
assert.ok(ownerCookie.length > 0, 'the test needs an owner session cookie');

useDocumentHeaders(browser(ownerCookie));
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
      document: firstSave(text),
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

/** One isolated local store, as one device would open it. */
async function openStore(
  prefix: string,
  deviceId: string,
): Promise<LocalStore> {
  return openLocalStore('https://notes.test', {
    indexedDB: new IDBFactory(),
    IDBKeyRange: FakeKeyRange,
    databaseName: `notesapp-sync-${prefix}`,
    deviceId,
  });
}

/** One editor working copy of one note. */
function draftOf(
  accountId: string,
  workingCopyId: string,
  fileId: string,
  baseRevisionId: string | null,
  text: string,
  path: string,
  sequence: number,
): Draft {
  return {
    accountId,
    workspaceId,
    workingCopyId,
    fileId,
    baseRevisionId,
    text,
    path,
    deleted: false,
    sequence,
  };
}

/** Saves one draft and checkpoints it, returning whether it queued. */
async function checkpointText(store: LocalStore, draft: Draft): Promise<void> {
  await store.saveDraft(draft);
  const queued = await store.checkpoint(draft, null);
  assert.ok(queued !== null, 'the checkpoint must queue a mutation');
}

/** One running engine with recorded announcements. */
type RunHandle = {
  readonly engine: SyncEngine;
  readonly controller: AbortController;
  readonly running: Promise<void>;
  readonly notices: SyncNotice[];
  readonly store: LocalStore;
};

function startEngine(
  store: LocalStore,
  cookie: string,
  ownerId: string,
  accountId = ownerAccountId,
): RunHandle {
  const notices: SyncNotice[] = [];
  const engine = createSyncEngine(store, accountId, workspaceId, {
    ownerId,
    headers: () => browser(cookie),
    pollIntervalMs: 50,
    announce: (notice: SyncNotice) => {
      notices.push(notice);
    },
  });
  const controller = new AbortController();
  const running = engine.run(controller.signal);
  return { engine, controller, running, notices, store };
}

/** Stops a running engine. */
async function stopEngine(handle: RunHandle): Promise<void> {
  handle.controller.abort();
  handle.engine.stop();
  await handle.running;
}

/**
 * Pulls the current server state into a store with nothing queued.
 *
 * A device syncs before its first offline edit, so later checkpoints carry
 * the accepted heads they really saw. Tests mirror that order.
 */
async function syncPull(
  store: LocalStore,
  cookie: string,
  ownerId: string,
  accountId = ownerAccountId,
): Promise<void> {
  const pulled = startEngine(store, cookie, ownerId, accountId);
  try {
    await waitFor(
      async () => (await store.readCursor(accountId, workspaceId)) !== null,
      `the initial pull of ${ownerId}`,
    );
  } finally {
    await stopEngine(pulled);
  }
}

/** Waits until a condition holds, failing loudly on timeout. */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  detail: string,
): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > 20000)
      throw new Error(`the sync test stalled while waiting: ${detail}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The queued mutations of one account and workspace. */
async function queuedOf(store: LocalStore, account = ownerAccountId) {
  return store.pending(account, workspaceId);
}

await test('a later offline save joins the work it never saw', async () => {
  const file = await newFile('notes/shared.md', '# Base\n');
  const storeA = await openStore('ab-a', 'device-a');
  const storeB = await openStore('ab-b', 'device-b');
  try {
    // Both devices download the base before going offline, so their
    // checkpoints carry the accepted head they really saw.
    await syncPull(storeA, ownerCookie, 'engine-a-pull');
    await syncPull(storeB, ownerCookie, 'engine-b-pull');
    await checkpointText(
      storeA,
      draftOf(
        ownerAccountId,
        'working-a',
        file.fileId,
        file.revisionId,
        '# Base\nFrom A\n',
        'notes/shared.md',
        1,
      ),
    );
    await checkpointText(
      storeB,
      draftOf(
        ownerAccountId,
        'working-b',
        file.fileId,
        file.revisionId,
        '# Base\nFrom B\n',
        'notes/shared.md',
        1,
      ),
    );

    const runA = startEngine(storeA, ownerCookie, 'engine-a');
    try {
      await waitFor(
        async () => (await queuedOf(storeA)).length === 0,
        'engine A drains its queue',
      );
    } finally {
      await stopEngine(runA);
    }
    const live = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    assert.equal(live.error, undefined, JSON.stringify(live.error));
    assert.equal(live.data?.head?.text, '# Base\nFrom A\n');

    const runB = startEngine(storeB, ownerCookie, 'engine-b');
    try {
      await waitFor(
        async () => (await queuedOf(storeB)).length === 0,
        'engine B drains its stale save',
      );
    } finally {
      await stopEngine(runB);
    }
    const localB = await storeB.listCheckpoints(
      ownerAccountId,
      workspaceId,
      file.fileId,
    );
    const tipB = localB[localB.length - 1]?.revisionId ?? '';
    assert.ok(tipB.length > 0, 'device B must keep its checkpoint');
    assert.equal(
      localB[localB.length - 1]?.digest,
      await contentDigest('# Base\nFrom B\n'),
      "device B's text must stay in local history",
    );
    // Both devices wrote over the same base, so the later save joins the work
    // it never saw rather than replacing it. The note carries both edits, the
    // revision says that it merged, and the device keeps its own checkpoint
    // for Review (records 0081, 0083, 0087).
    const kept = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    const joined = kept.data?.head?.text ?? '';
    assert.ok(joined.includes('From A'), joined);
    assert.ok(joined.includes('From B'), joined);
    assert.equal(kept.data?.head?.merged, true);
    const history = await listHistory({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    assert.equal(history.data?.revisions.length, 3);
  } finally {
    await storeA.close();
    await storeB.close();
  }
});

await test('an accepted mutation replays exactly after later heads', async () => {
  const fileId = randomUUID();
  const firstRevision = randomUUID();
  const mutationId = randomUUID();
  const firstText = '# Replay one\n';
  const clientTime = new Date().toISOString();
  const body = {
    mutationId,
    deviceId: 'integration-device',
    expectedHeads: { [fileId]: null },
    revisions: [
      {
        revisionId: firstRevision,
        fileId,
        parents: [],
        path: 'notes/replay.md',
        deleted: false,
        content: {
          kind: 'markdown' as const,
          document: firstSave(firstText),
        },
        clientTime,
      },
    ],
  };
  const first = await commitChangeset({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body,
  });
  assert.equal(first.error, undefined, JSON.stringify(first.error));
  assert.deepEqual(first.data?.revisionIds, [firstRevision]);

  const secondRevision = randomUUID();
  const second = await updateFile({
    headers: { ...browser(ownerCookie), 'if-match': `"${firstRevision}"` },
    path: { workspaceId, fileId },
    body: {
      document: await saveForHead(workspaceId, firstRevision, '# Replay two\n'),
      revisionId: secondRevision,
      mutationId: randomUUID(),
      deviceId: 'integration-device',
    },
  });
  assert.equal(second.error, undefined, JSON.stringify(second.error));

  // The dropped accepted response: the same identity with the same body must
  // answer with the first outcome instead of writing a second revision.
  const replay = await commitChangeset({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body,
  });
  assert.equal(replay.error, undefined, JSON.stringify(replay.error));
  assert.deepEqual(replay.data?.revisionIds, [firstRevision]);

  const history = await listHistory({
    headers: browser(ownerCookie),
    path: { workspaceId, fileId },
  });
  assert.equal(history.error, undefined, JSON.stringify(history.error));
  assert.equal(history.data?.revisions.length, 2);
});

await test('later local edits during acknowledgment join one atomic commit', async () => {
  const store = await openStore('batch', 'device-batch');
  try {
    const fileId = randomUUID();
    await checkpointText(
      store,
      draftOf(
        ownerAccountId,
        'working-batch',
        fileId,
        null,
        '# Batch one\n',
        'notes/batch.md',
        1,
      ),
    );
    await checkpointText(
      store,
      draftOf(
        ownerAccountId,
        'working-batch',
        fileId,
        null,
        '# Batch two\n',
        'notes/batch.md',
        2,
      ),
    );
    assert.equal((await queuedOf(store)).length, 2);

    const run = startEngine(store, ownerCookie, 'engine-batch');
    try {
      await waitFor(
        async () => (await queuedOf(store)).length === 0,
        'the batched edits drain together',
      );
    } finally {
      await stopEngine(run);
    }

    const history = await listHistory({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId },
    });
    assert.equal(history.error, undefined, JSON.stringify(history.error));
    assert.equal(history.data?.revisions.length, 2);
    const texts: string[] = [];
    for (const item of history.data?.revisions ?? []) {
      const fetched = await getRevision({
        headers: browser(ownerCookie),
        path: { workspaceId, revisionId: item.revisionId },
      });
      assert.equal(fetched.error, undefined, JSON.stringify(fetched.error));
      texts.push(fetched.data?.text ?? '');
    }
    // History reads newest first.
    assert.deepEqual(texts, ['# Batch two\n', '# Batch one\n']);

    const kept = await store.readDraft(
      ownerAccountId,
      workspaceId,
      'working-batch',
    );
    assert.equal(kept?.text, '# Batch two\n');
  } finally {
    await store.close();
  }
});

await test('a late offline write after a purge is forgotten', async () => {
  const file = await newFile('notes/doomed.md', '# Doomed\n');
  const purged = await purgeFiles({
    headers: browser(ownerCookie),
    path: { workspaceId },
    body: { mutationId: randomUUID(), fileIds: [file.fileId] },
  });
  assert.equal(purged.error, undefined, JSON.stringify(purged.error));

  const store = await openStore('purge', 'device-purge');
  try {
    await syncPull(store, ownerCookie, 'engine-purge-pull');
    await checkpointText(
      store,
      draftOf(
        ownerAccountId,
        'working-doom',
        file.fileId,
        file.revisionId,
        '# Doomed edit\n',
        'notes/doomed.md',
        1,
      ),
    );
    const run = startEngine(store, ownerCookie, 'engine-purge');
    try {
      await waitFor(
        async () => (await queuedOf(store)).length === 0,
        'the purged write is forgotten',
      );
    } finally {
      await stopEngine(run);
    }
    // A purged file is gone for good, so its late local work is dropped rather
    // than parked in front of the person. No conflict, no recovery, no notice.
    assert.ok(
      !run.notices.some((notice) => notice.kind === 'preserved'),
      'a purged write is not preserved',
    );
    const kept = await store.listCheckpoints(
      ownerAccountId,
      workspaceId,
      file.fileId,
    );
    assert.equal(kept.length, 0);
    assert.deepEqual(await store.recover(ownerAccountId, workspaceId), []);
    const files = await store.listLocalFiles(ownerAccountId, workspaceId);
    assert.ok(
      !files.some((summary) => summary.fileId === file.fileId),
      'the purged note is gone from the local file list',
    );

    const gone = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    assert.notEqual(gone.error, undefined);
    assert.equal(responseOf(gone.response).status, 410);
    assert.equal(problemCode(gone.error), 'purged');
  } finally {
    await store.close();
  }
});

await test('an expired cursor restarts from a snapshot without losing the queue', async () => {
  const store = await openStore('cursor', 'device-cursor');
  try {
    const fileId = randomUUID();
    await checkpointText(
      store,
      draftOf(
        ownerAccountId,
        'working-cursor',
        fileId,
        null,
        '# Cursor\n',
        'notes/cursor.md',
        1,
      ),
    );
    await store.applyRemoteChanges(ownerAccountId, workspaceId, [], '0');

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

    const run = startEngine(store, ownerCookie, 'engine-cursor');
    try {
      await waitFor(
        async () =>
          (await queuedOf(store)).length === 0 &&
          ((await store.readCursor(ownerAccountId, workspaceId)) ?? '0') !==
            '0',
        'the engine converges after the cursor expiry',
      );
    } finally {
      await stopEngine(run);
    }
    assert.ok(
      run.notices.some((notice) => notice.kind === 'snapshot-restart'),
      'the expired cursor must restart the download',
    );

    const live = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId },
    });
    assert.equal(live.error, undefined, JSON.stringify(live.error));
    assert.equal(live.data?.head?.text, '# Cursor\n');
  } finally {
    await store.close();
  }
});

await test('an expired lease is taken over and a held lease keeps a follower waiting', async () => {
  const store = await openStore('lease', 'device-lease');
  try {
    const fileId = randomUUID();
    await checkpointText(
      store,
      draftOf(
        ownerAccountId,
        'working-lease',
        fileId,
        null,
        '# Lease\n',
        'notes/lease.md',
        1,
      ),
    );
    assert.equal(
      await store.acquireLease('stale-owner', Date.now() - 1000),
      true,
      'the test needs a stale lease to take over',
    );

    const run = startEngine(store, ownerCookie, 'engine-lease');
    try {
      await waitFor(
        async () =>
          (await queuedOf(store)).length === 0 &&
          (await store.readCursor(ownerAccountId, workspaceId)) !== null,
        'the takeover drains the queue and syncs a cursor',
      );
    } finally {
      await stopEngine(run);
    }
    assert.ok(
      !run.notices.some((notice) => notice.kind === 'lease-held'),
      'an expired lease must be taken over, not refused',
    );
    const live = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId },
    });
    assert.equal(live.data?.head?.text, '# Lease\n');

    assert.equal(
      await store.acquireLease('manual-holder', Date.now() + 60_000),
      true,
    );
    const second = startEngine(store, ownerCookie, 'engine-second');
    await waitFor(
      () => second.notices.some((notice) => notice.kind === 'lease-held'),
      'the follower observes the held lease',
    );
    assert.equal((await store.readLeaseState())?.ownerId, 'manual-holder');
    await stopEngine(second);
    await store.releaseLease('manual-holder');
    assert.equal(
      (await store.readCursor(ownerAccountId, workspaceId)) !== null,
      true,
      'the earlier run must have synced a cursor',
    );
  } finally {
    await store.close();
  }
});

await test('an edit that arrives after a delete brings the note back', async () => {
  const file = await newFile('notes/keep.md', '# Base\n');
  const storeA = await openStore('recover-a', 'device-a');
  const storeB = await openStore('recover-b', 'device-b');
  try {
    await syncPull(storeA, ownerCookie, 'engine-recover-a-pull');
    await syncPull(storeB, ownerCookie, 'engine-recover-b-pull');

    // Device A edits the note offline; device B deletes it offline.
    await checkpointText(
      storeA,
      draftOf(
        ownerAccountId,
        'working-a',
        file.fileId,
        file.revisionId,
        '# My edit\n',
        'notes/keep.md',
        1,
      ),
    );
    const removal: Draft = {
      ...draftOf(
        ownerAccountId,
        'working-b',
        file.fileId,
        file.revisionId,
        '',
        'notes/keep.md',
        1,
      ),
      deleted: true,
    };
    await storeB.saveDraft(removal);
    assert.ok((await storeB.checkpoint(removal, null)) !== null);

    // Device B deletes first, so the note is a tombstone. Device A's edit can
    // no longer apply to it.
    const runB = startEngine(storeB, ownerCookie, 'engine-recover-b');
    try {
      await waitFor(
        async () => (await queuedOf(storeB)).length === 0,
        'device B drains its delete',
      );
    } finally {
      await stopEngine(runB);
    }
    const runA = startEngine(storeA, ownerCookie, 'engine-recover-a');
    try {
      await waitFor(
        async () => (await queuedOf(storeA)).length === 0,
        'device A drains its edit and the recovered note',
      );
    } finally {
      await stopEngine(runA);
    }

    // The edit is the later write and the tombstone kept the document behind
    // it, so the note returns with that text. No second note is created and
    // nothing waits in a recovery inbox (record 0083).
    const original = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    assert.equal(original.error, undefined, JSON.stringify(original.error));
    assert.equal(original.data?.head?.deleted, false);
    assert.ok(
      (original.data?.head?.text ?? '').includes('# My edit'),
      original.data?.head?.text ?? '',
    );
    assert.deepEqual(await storeA.recover(ownerAccountId, workspaceId), []);
    const files = await storeA.listLocalFiles(ownerAccountId, workspaceId);
    assert.equal(
      files.find((summary) => summary.path === 'notes/keep (recovered).md'),
      undefined,
      'the note came back, so no recovered copy is needed',
    );
  } finally {
    await storeA.close();
    await storeB.close();
  }
});

await test('a device that only opened a note keeps the newer text', async () => {
  const file = await newFile('notes/opened-only.md', '# Base\n');
  const storeA = await openStore('opened-a', 'device-opened-a');
  try {
    await syncPull(storeA, ownerCookie, 'engine-opened-a-pull');
    // The editor opens the note and flushes its buffer, which every editor
    // does on a blur and on the way out. The person types nothing.
    await storeA.saveDraft(
      draftOf(
        ownerAccountId,
        'working-opened-a',
        file.fileId,
        file.revisionId,
        '# Base\n',
        'notes/opened-only.md',
        1,
      ),
    );

    // Another device writes the note.
    const elsewhere = await updateFile({
      headers: { ...browser(ownerCookie), 'if-match': `"${file.revisionId}"` },
      path: { workspaceId, fileId: file.fileId },
      body: {
        document: await saveForHead(
          workspaceId,
          file.revisionId,
          '# Written elsewhere\n',
        ),
        revisionId: randomUUID(),
        mutationId: randomUUID(),
        deviceId: 'device-elsewhere',
      },
    });
    assert.equal(elsewhere.error, undefined, JSON.stringify(elsewhere.error));

    // This device reads that version.
    const pulling = startEngine(storeA, ownerCookie, 'engine-opened-a-feed');
    try {
      await waitFor(async () => {
        const seen = await storeA.readFileSaveSnapshot(
          ownerAccountId,
          workspaceId,
          file.fileId,
        );
        return seen.acceptedHeadRevisionId !== file.revisionId;
      }, 'the opened device reads the version of the other device');
    } finally {
      await stopEngine(pulling);
    }

    // The note now opens with the newer text, and the working copy that held
    // the replaced text is gone, so nothing shadows it.
    const cached = await storeA.readCachedNote(
      ownerAccountId,
      workspaceId,
      file.fileId,
    );
    assert.equal(cached?.text, '# Written elsewhere\n');
    assert.equal(cached?.stale, false);
    assert.equal(
      await storeA.readDraft(ownerAccountId, workspaceId, 'working-opened-a'),
      null,
    );

    // The flush that the editor writes when the tab is hidden creates no
    // version, because the buffer says what the accepted head already says.
    assert.equal(
      await storeA.checkpoint(
        draftOf(
          ownerAccountId,
          'working-opened-a',
          file.fileId,
          cached?.baseRevisionId ?? null,
          '# Written elsewhere\n',
          'notes/opened-only.md',
          2,
        ),
        null,
      ),
      null,
    );
    const live = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    assert.equal(live.data?.head?.text, '# Written elsewhere\n');
  } finally {
    await storeA.close();
  }
});

await test('a save over work it never saw joins it and offers Review', async () => {
  const file = await newFile('notes/rebased.md', '# Base\n');
  const storeA = await openStore('rebase-a', 'device-rebase-a');
  try {
    await syncPull(storeA, ownerCookie, 'engine-rebase-a-pull');
    // This device types over the base and keeps the save on the device.
    await checkpointText(
      storeA,
      draftOf(
        ownerAccountId,
        'working-rebase-a',
        file.fileId,
        file.revisionId,
        '# Base\nMine\n',
        'notes/rebased.md',
        1,
      ),
    );
    const elsewhere = await updateFile({
      headers: { ...browser(ownerCookie), 'if-match': `"${file.revisionId}"` },
      path: { workspaceId, fileId: file.fileId },
      body: {
        document: await saveForHead(
          workspaceId,
          file.revisionId,
          '# Base\nTheirs\n',
        ),
        revisionId: randomUUID(),
        mutationId: randomUUID(),
        deviceId: 'device-elsewhere',
      },
    });
    assert.equal(elsewhere.error, undefined, JSON.stringify(elsewhere.error));

    const runA = startEngine(storeA, ownerCookie, 'engine-rebase-a');
    try {
      await waitFor(
        async () => (await queuedOf(storeA)).length === 0,
        'the rebased device drains its save',
      );
    } finally {
      await stopEngine(runA);
    }

    // Both edits reach the note: the device that saved last joined the work
    // it had not seen, so no text is lost (records 0081, 0087).
    const live = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    const merged = live.data?.head?.text ?? '';
    assert.ok(merged.includes('Mine'), merged);
    assert.ok(merged.includes('Theirs'), merged);
    assert.equal(live.data?.head?.merged, true);
    // The checkpoint of this device keeps the text it saved, so Review can
    // show the person what they wrote (record 0087).
    const local = await storeA.listCheckpoints(
      ownerAccountId,
      workspaceId,
      file.fileId,
    );
    assert.equal(
      local[local.length - 1]?.digest,
      await contentDigest('# Base\nMine\n'),
    );
    const history = await listHistory({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    assert.deepEqual(
      history.data?.revisions.map((revision) => revision.revisionId).length,
      3,
    );
    assert.ok(
      runA.notices.some((notice) => notice.kind === 'superseded'),
      'the device tells the person that its save joined other work',
    );
  } finally {
    await storeA.close();
  }
});

await test('a restore reaches the device that asked for it', async () => {
  const file = await newFile('notes/restored.md', '# Keep\n');
  const storeA = await openStore('restore-a', 'device-restore-a');
  try {
    await syncPull(storeA, ownerCookie, 'engine-restore-a-pull');
    await storeA.trashFiles(ownerAccountId, workspaceId, [file.fileId]);
    const runA = startEngine(storeA, ownerCookie, 'engine-restore-a');
    try {
      await waitFor(
        async () => (await queuedOf(storeA)).length === 0,
        'the restoring device sends its deletion',
      );
      const restored = await restoreFile({
        headers: browser(ownerCookie),
        path: { workspaceId, fileId: file.fileId },
        body: {
          mutationId: randomUUID(),
          deviceId: storeA.deviceId,
          clientTime: new Date().toISOString(),
          revisionId: randomUUID(),
        },
      });
      assert.equal(restored.error, undefined, JSON.stringify(restored.error));
      await waitFor(async () => {
        const cached = await storeA.readCachedNote(
          ownerAccountId,
          workspaceId,
          file.fileId,
        );
        return cached?.deleted === false && cached.text === '# Keep\n';
      }, 'the restore reaches the device that asked for it');
    } finally {
      await stopEngine(runA);
    }
  } finally {
    await storeA.close();
  }
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
