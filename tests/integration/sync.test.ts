/**
 * Foreground sync checks against a real server, a real database, and real
 * sessions with a real IndexedDB-backed local store per device.
 *
 * Every application call goes through a generated operation function, and
 * every local record goes through `openLocalStore` over an isolated
 * `fake-indexeddb` backend. The engine under test is `createSyncEngine`
 * with its default operations, so these tests prove the wire behavior:
 * offline chains, lost answers, lease takeover, purge preservation, cursor
 * expiry, and role recovery.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IDBFactory, IDBKeyRange as FakeKeyRange } from 'fake-indexeddb';
import {
  acceptInvitation,
  commitChangeset,
  configureClient,
  createFile,
  getAccount,
  getFile,
  getRevision,
  inviteMember,
  listBranches,
  listHistory,
  listWorkspaces,
  purgeFiles,
  signInWithPassword,
  updateFile,
  updateMember,
} from '@notesapp/api-client';
import { contentDigest } from '@notesapp/core';
import {
  bootstrapOwner,
  createAuth,
  createAuthPool,
  createAuthProtocol,
  createHandlers,
  createIdentityAdapter,
  createInvitationAccounts,
  createSyncCleanup,
  loadServerConfig,
  type ServerConfig,
} from '@notesapp/server';
import {
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
  return { origin: 'https://notes.test', cookie };
}

/** The SHA-256 digest of UTF-8 Markdown, as the design defines it. */
function sha256hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-sync-test-'));

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
    NOTESAPP_AUTH_SECRET: 'sync-test-secret-value-0123456789abcdef',
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
const invitations = createInvitationAccounts(config, {
  identity,
  pool: authPool,
  resolveActor: (request) => adapter.resolveActor(request),
});

const server = await startTestServer({
  environment: environment(),
  handlers: (value) =>
    createHandlers(value, undefined, {
      store: identity,
      content,
      attachments,
      invitations,
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

const memberEmail = 'sync-editor@notes.invalid';
const memberPassword = 'editor-password-123456';
const invited = await inviteMember({
  headers: browser(ownerCookie),
  path: { workspaceId },
  body: { email: memberEmail, role: 'editor' },
});
assert.equal(invited.error, undefined);
const memberAccepted = await acceptInvitation({
  headers: { origin: 'https://notes.test' },
  body: { token: invited.data?.token ?? '', password: memberPassword },
});
assert.equal(memberAccepted.error, undefined);
const memberCookie = cookieHeader(
  responseOf(memberAccepted.response).headers.getSetCookie(),
);
assert.ok(memberCookie.length > 0, 'the test needs a member session cookie');

const memberAccount = await getAccount({ headers: browser(memberCookie) });
const memberAccountId = memberAccount.data?.accountId ?? '';
assert.match(memberAccountId, /^[0-9a-f-]{36}$/);

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

await test('offline edits on two devices keep both branches', async () => {
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
        '# A\n',
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
        '# B\n',
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
    assert.equal(live.data?.head?.text, '# A\n');

    const runB = startEngine(storeB, ownerCookie, 'engine-b');
    try {
      await waitFor(
        async () =>
          (await queuedOf(storeB)).every(
            (entry) => entry.state === 'conflict',
          ) && (await queuedOf(storeB)).length === 1,
        'engine B preserves its conflicting mutation',
      );
    } finally {
      await stopEngine(runB);
    }
    assert.ok(
      runB.notices.some((notice) => notice.kind === 'conflict'),
      'the stale head must be announced as a conflict',
    );

    const branches = await listBranches({
      headers: browser(ownerCookie),
      path: { workspaceId },
      query: { fileId: file.fileId, state: 'unresolved' },
    });
    assert.equal(branches.error, undefined, JSON.stringify(branches.error));
    const localB = await storeB.listCheckpoints(
      ownerAccountId,
      workspaceId,
      file.fileId,
    );
    const tipB = localB[localB.length - 1]?.revisionId ?? '';
    assert.ok(tipB.length > 0, 'device B must keep its checkpoint');
    const tips = (branches.data?.branches ?? []).map(
      (branch) => branch.tipRevisionId,
    );
    assert.ok(
      tips.includes(tipB),
      "device B's offline revision must survive as a branch",
    );
    assert.equal(
      localB[localB.length - 1]?.digest,
      await contentDigest('# B\n'),
      "device B's text must be preserved",
    );
    const kept = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    assert.equal(kept.data?.head?.text, '# A\n');
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
          digest: sha256hex(firstText),
          text: firstText,
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
      text: '# Replay two\n',
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

    const branches = await listBranches({
      headers: browser(ownerCookie),
      path: { workspaceId },
      query: { fileId, state: 'unresolved' },
    });
    assert.equal(branches.error, undefined, JSON.stringify(branches.error));
    assert.equal(
      branches.data?.branches.length,
      0,
      'a linear local chain must not branch',
    );

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

await test('a late offline write after a purge keeps its local work', async () => {
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
        async () =>
          (await queuedOf(store)).every(
            (entry) => entry.state === 'conflict',
          ) && (await queuedOf(store)).length === 1,
        'the purged write is preserved as a conflict',
      );
    } finally {
      await stopEngine(run);
    }
    assert.ok(
      run.notices.some(
        (notice) => notice.kind === 'preserved' && notice.code === 'purged',
      ),
      'the purge must be announced without dropping the entry',
    );

    const kept = await store.listCheckpoints(
      ownerAccountId,
      workspaceId,
      file.fileId,
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.digest, await contentDigest('# Doomed edit\n'));

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

await test('a viewer downgrade suspends writes and an editor restore resumes them', async () => {
  const file = await newFile('notes/member-note.md', '# Member base\n');
  const store = await openStore('member', 'device-member');
  try {
    await syncPull(store, memberCookie, 'engine-member-pull', memberAccountId);
    await checkpointText(
      store,
      draftOf(
        memberAccountId,
        'working-member',
        file.fileId,
        file.revisionId,
        '# Member edit\n',
        'notes/member-note.md',
        1,
      ),
    );
    const demote = await updateMember({
      headers: browser(ownerCookie),
      path: { workspaceId, accountId: memberAccountId },
      body: { role: 'viewer' },
    });
    assert.equal(demote.error, undefined, JSON.stringify(demote.error));

    const run = startEngine(
      store,
      memberCookie,
      'engine-member',
      memberAccountId,
    );
    try {
      await waitFor(
        () => run.notices.some((notice) => notice.kind === 'role-downgraded'),
        'the downgrade suspends writes',
      );
      assert.equal((await queuedOf(store, memberAccountId)).length, 1);
      const held = await getFile({
        headers: browser(ownerCookie),
        path: { workspaceId, fileId: file.fileId },
      });
      assert.equal(held.data?.head?.text, '# Member base\n');

      const restore = await updateMember({
        headers: browser(ownerCookie),
        path: { workspaceId, accountId: memberAccountId },
        body: { role: 'editor' },
      });
      assert.equal(restore.error, undefined, JSON.stringify(restore.error));
      await waitFor(
        async () => (await queuedOf(store, memberAccountId)).length === 0,
        'the restored role drains the queue',
      );
    } finally {
      await stopEngine(run);
    }
    assert.ok(
      run.notices.some((notice) => notice.kind === 'writes-resumed'),
      'the restored role must resume writes',
    );
    const live = await getFile({
      headers: browser(ownerCookie),
      path: { workspaceId, fileId: file.fileId },
    });
    assert.equal(live.data?.head?.text, '# Member edit\n');
  } finally {
    await store.close();
  }
});

await test('an expired lease is taken over and a held lease stops a second worker', async () => {
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
    await second.running;
    assert.deepEqual(second.notices, [{ kind: 'lease-held' }]);
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

// Teardown
await server.close();
await auth.close();
await authPool.end();
await attachments.close();
await content.close();
await identity.close();
await rm(storageRoot, { recursive: true, force: true });
await database.destroy();
