/**
 * Offline PWA lifecycle checks as module tests.
 *
 * These tests run the real local store over an isolated `fake-indexeddb`
 * backend together with the pure lifecycle rules: readiness needs Markdown
 * and application assets while attachment completeness stays separate,
 * blocked schema upgrades refuse without losing drafts, offline sign-out
 * records a marker that reconnect revokes before anything is restored, and
 * recovery records stay bound to the account that wrote them.
 *
 * Nothing here touches the network and no generated operation is called:
 * revocation is an injected callback that records its order, so the test
 * proves that revocation runs before the marker clears. Actual browser
 * eviction, installation, and retention remain evidence for the authorized
 * device stage.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory, IDBKeyRange as FakeKeyRange } from 'fake-indexeddb';
import {
  blockedUpgradeInstructions,
  createDatabase,
  isBlockedUpgradeError,
  metaKey,
  openLocalStore,
  type LocalStoreOptions,
} from '@notesapp/storage-browser';
import {
  isLeaseExpired,
  LocalStorageError,
  readWorkerLease,
  type Draft,
  type LocalStore,
} from '@notesapp/sync';
import {
  completePendingSignOut,
  copyPendingToRecovery,
  downloadProgress,
  isReadyOffline,
  isRecoveryVisible as isRecordVisible,
  prepareForUpdate,
  signOut,
  SignOutBlockedError,
} from '../../apps/web/src/pwa/lifecycle.ts';

const origin = 'https://notes.example.test';

/** A counted clock, so every record carries a distinct client time. */
function createClock(): () => number {
  let current = Date.parse('2026-09-06T10:00:00.000Z');
  return () => {
    current += 1000;
    return current;
  };
}

/** A counted identifier source, so a failure names the record that differs. */
function createIds(prefix: string): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
  };
}

/** One isolated database and the options that open it. */
type Backend = {
  readonly name: string;
  readonly factory: IDBFactory;
  options: (extra?: Partial<LocalStoreOptions>) => LocalStoreOptions;
};

function createBackend(prefix: string): Backend {
  const factory = new IDBFactory();
  const name = `notesapp-lifecycle-${prefix}`;
  return {
    name,
    factory,
    options: (extra = {}) => ({
      indexedDB: factory,
      IDBKeyRange: FakeKeyRange,
      databaseName: name,
      now: createClock(),
      id: createIds(prefix),
      deviceId: `device-${prefix}`,
      ...extra,
    }),
  };
}

/** One editor working copy of one note. */
function draftOf(
  accountId: string,
  workspaceId: string,
  fileId: string,
  text: string,
  sequence = 1,
): Draft {
  return {
    accountId,
    workspaceId,
    workingCopyId: `copy-${fileId.slice(0, 8)}`,
    fileId,
    baseRevisionId: null,
    text,
    path: 'notes/one.md',
    deleted: false,
    sequence,
  };
}

/** Queues one pending mutation in one workspace. */
async function queueOne(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  fileId: string,
  text: string,
): Promise<void> {
  const draft = draftOf(accountId, workspaceId, fileId, text);
  await store.saveDraft(draft);
  const entry = await store.checkpoint(draft, null);
  assert.notEqual(entry, null, 'the draft must queue a mutation');
}

await test('readiness needs Markdown and assets, never attachments', () => {
  assert.equal(
    isReadyOffline({
      markdownComplete: true,
      appAssetsComplete: true,
      attachmentsComplete: true,
    }),
    true,
  );
  assert.equal(
    isReadyOffline({
      markdownComplete: true,
      appAssetsComplete: true,
      attachmentsComplete: false,
    }),
    true,
  );
  assert.equal(
    isReadyOffline({
      markdownComplete: false,
      appAssetsComplete: true,
      attachmentsComplete: true,
    }),
    false,
  );
  assert.equal(
    isReadyOffline({
      markdownComplete: true,
      appAssetsComplete: false,
      attachmentsComplete: true,
    }),
    false,
  );
  assert.equal(
    isReadyOffline({
      markdownComplete: false,
      appAssetsComplete: false,
      attachmentsComplete: false,
    }),
    false,
  );
});

await test('download positions report percent and completion', () => {
  assert.deepEqual(downloadProgress(0, 0), {
    downloaded: 0,
    total: 0,
    percent: 100,
    complete: true,
  });
  assert.deepEqual(downloadProgress(1, 4), {
    downloaded: 1,
    total: 4,
    percent: 25,
    complete: false,
  });
  assert.deepEqual(downloadProgress(4, 4), {
    downloaded: 4,
    total: 4,
    percent: 100,
    complete: true,
  });
  // Over-delivery clamps instead of reporting more than the plan.
  assert.deepEqual(downloadProgress(9, 4), {
    downloaded: 4,
    total: 4,
    percent: 100,
    complete: true,
  });
});

await test('a newer stored schema blocks the upgrade without losing drafts', async () => {
  const backend = createBackend('blocked-newer');
  const first = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  await queueOne(first, account, workspace, file, 'kept text\n');
  await first.close();

  const { db, tables } = createDatabase(backend.name, {
    indexedDB: backend.factory,
    IDBKeyRange: FakeKeyRange,
  });
  await db.open();
  try {
    const meta = await tables.meta.get(metaKey);
    assert.ok(meta !== undefined, 'the database holds no meta record');
    await tables.meta.put({ ...meta, schemaVersion: 99 });
  } finally {
    db.close();
  }

  const failure: unknown = await openLocalStore(origin, backend.options()).then(
    () => null,
    (reason: unknown) => reason,
  );
  assert.ok(failure instanceof LocalStorageError);
  assert.equal(failure.kind, 'corrupt');
  assert.equal(isBlockedUpgradeError(failure), true);
  assert.ok(blockedUpgradeInstructions.includes('No draft is discarded'));
});

await test('an interrupted migration with a bad record is refused', async () => {
  const backend = createBackend('blocked-bad-record');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  await store.saveDraft(draftOf(account, workspace, randomUUID(), 'text\n'));
  await store.close();

  const { db, tables } = createDatabase(backend.name, {
    indexedDB: backend.factory,
    IDBKeyRange: FakeKeyRange,
  });
  await db.open();
  try {
    const meta = await tables.meta.get(metaKey);
    assert.ok(meta !== undefined, 'the database holds no meta record');
    await tables.meta.put({ ...meta, migrationState: 'in-progress' });
    const rows = await tables.drafts.toArray();
    const row = rows[0];
    assert.ok(row !== undefined);
    await tables.drafts.put({ ...row, sequence: Number.NaN });
  } finally {
    db.close();
  }

  await assert.rejects(
    openLocalStore(origin, backend.options()),
    (error: unknown) => isBlockedUpgradeError(error),
  );
});

await test('a non-schema local failure is not a blocked upgrade', () => {
  assert.equal(isBlockedUpgradeError(new Error('boom')), false);
  assert.equal(
    isBlockedUpgradeError(new LocalStorageError('quota', 'full')),
    false,
  );
  assert.equal(
    isBlockedUpgradeError(new LocalStorageError('aborted', 'retry')),
    false,
  );
});

await test('online sign-out revokes before it clears private data', async () => {
  const backend = createBackend('online-signout');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  await queueOne(store, account, workspace, file, 'pending\n');

  const events: string[] = [];
  await signOut(store, account, [workspace], true, true, () => {
    events.push('revoke');
    return Promise.resolve();
  });
  events.push('cleared');

  assert.deepEqual(events, ['revoke', 'cleared']);
  assert.deepEqual(await store.pending(account, workspace), []);
  assert.equal(
    await store.readDraft(account, workspace, `copy-${file.slice(0, 8)}`),
    null,
  );
  assert.equal(await store.hasSignOutMarker(account), false);
  await store.close();
});

await test('sign-out without an explicit discard is refused', async () => {
  const backend = createBackend('needs-discard');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  await queueOne(store, account, workspace, randomUUID(), 'pending\n');

  let revoked = false;
  await assert.rejects(
    signOut(store, account, [workspace], true, false, () => {
      revoked = true;
      return Promise.resolve();
    }),
    (error: unknown) =>
      error instanceof SignOutBlockedError && error.code === 'needs-discard',
  );
  assert.equal(revoked, false);
  assert.equal((await store.pending(account, workspace)).length, 1);

  await assert.rejects(
    signOut(store, account, [workspace], false, false, () => Promise.resolve()),
    (error: unknown) =>
      error instanceof SignOutBlockedError && error.code === 'needs-discard',
  );
  assert.equal(await store.hasSignOutMarker(account), false);
  await store.close();
});

await test('offline sign-out clears data, keeps the marker, revokes on reconnect', async () => {
  const backend = createBackend('offline-signout');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  await queueOne(store, account, workspace, file, 'pending\n');

  const order: string[] = [];
  await signOut(store, account, [workspace], false, true, () => {
    order.push('revoke-while-offline');
    return Promise.resolve();
  });
  // Offline sign-out never revokes: there is no connection for HttpOnly state.
  assert.deepEqual(order, []);
  assert.equal(await store.hasSignOutMarker(account), true);
  assert.deepEqual(await store.pending(account, workspace), []);
  assert.equal(
    await store.readDraft(account, workspace, `copy-${file.slice(0, 8)}`),
    null,
  );
  await store.close();

  // The marker survives a restart of the same browser profile.
  const reopened = await openLocalStore(origin, backend.options());
  assert.equal(await reopened.hasSignOutMarker(account), true);

  const reconnectOrder: string[] = [];
  const processed = await completePendingSignOut(reopened, account, () => {
    reconnectOrder.push('revoke');
    return Promise.resolve();
  });
  assert.equal(processed, true);
  reconnectOrder.push('marker-cleared');
  assert.deepEqual(reconnectOrder, ['revoke', 'marker-cleared']);
  assert.equal(await reopened.hasSignOutMarker(account), false);
  // Nothing left to revoke twice.
  assert.equal(
    await completePendingSignOut(reopened, account, () => Promise.resolve()),
    false,
  );
  await reopened.close();
});

await test('a failed revocation keeps the marker for the next reconnect', async () => {
  const backend = createBackend('revoke-fails');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  await store.setSignOutMarker(account);

  await assert.rejects(
    completePendingSignOut(store, account, () =>
      Promise.reject(new Error('the network dropped')),
    ),
  );
  assert.equal(await store.hasSignOutMarker(account), true);
  await store.close();
});

await test('recovery copies stay bound to the original account', async () => {
  const backend = createBackend('recovery');
  const store = await openLocalStore(origin, backend.options());
  const accountA = randomUUID();
  const accountB = randomUUID();
  const workspace = randomUUID();
  const file = randomUUID();
  await queueOne(store, accountA, workspace, file, 'private edit\n');

  const copied = await copyPendingToRecovery(
    store,
    accountA,
    workspace,
    'purged',
  );
  assert.equal(copied, 1);

  const keptA = await store.recover(accountA, workspace);
  assert.equal(keptA.length, 1);
  const firstKept = keptA[0];
  assert.ok(firstKept !== undefined, 'the recovery copy must exist');
  assert.equal(firstKept.text, 'private edit\n');
  assert.equal(firstKept.reason, 'purged');
  assert.equal(isRecordVisible(firstKept, accountA), true);
  assert.equal(isRecordVisible(firstKept, accountB), false);

  // The queue itself is kept for a later retry; the recovery copy is extra.
  assert.equal((await store.pending(accountA, workspace)).length, 1);

  // The other account sees nothing and cannot remove what it cannot name.
  assert.deepEqual(await store.recover(accountB, workspace), []);
  assert.deepEqual(await store.pending(accountB, workspace), []);

  const stored = await store.addRecovery(accountA, workspace, {
    fileId: randomUUID(),
    path: 'notes/extra.md',
    text: 'extra\n',
    reason: 'sign_out',
  });
  await store.removeRecovery(accountB, workspace, stored.recoveryId);
  assert.equal((await store.recover(accountA, workspace)).length, 2);
  await store.removeRecovery(accountA, workspace, stored.recoveryId);
  assert.equal((await store.recover(accountA, workspace)).length, 1);
  await store.close();
});

await test('pins are workspace scoped and logout keeps only the marker', async () => {
  const backend = createBackend('pins');
  const store = await openLocalStore(origin, backend.options());
  const account = randomUUID();
  const workspace = randomUUID();
  const other = randomUUID();

  await store.setAttachmentPinned(account, workspace, 'digest-1', true);
  await store.setHistoryPinned(account, workspace, 'revision-1', true);
  assert.equal(
    await store.isAttachmentPinned(account, workspace, 'digest-1'),
    true,
  );
  assert.equal(
    await store.isHistoryPinned(account, workspace, 'revision-1'),
    true,
  );
  assert.equal(
    await store.isAttachmentPinned(account, other, 'digest-1'),
    false,
  );
  assert.equal(
    await store.isHistoryPinned(account, other, 'revision-1'),
    false,
  );

  await store.setAttachmentPinned(account, workspace, 'digest-1', false);
  assert.equal(
    await store.isAttachmentPinned(account, workspace, 'digest-1'),
    false,
  );

  await store.setAttachmentPinned(account, workspace, 'digest-2', true);
  const file = randomUUID();
  await queueOne(store, account, workspace, file, 'pending\n');
  await signOut(store, account, [workspace], false, true, () =>
    Promise.resolve(),
  );
  assert.equal(
    await store.isAttachmentPinned(account, workspace, 'digest-2'),
    false,
  );
  assert.equal(
    await store.isHistoryPinned(account, workspace, 'revision-1'),
    false,
  );
  assert.equal(await store.hasSignOutMarker(account), true);
  await store.close();
});

await test('an update waits while another tab holds a live lease', async () => {
  const backend = createBackend('update-lease');
  const store = await openLocalStore(origin, backend.options());
  let now = 1_000_000;
  const held = await store.acquireLease('other-tab', now + 30_000);
  assert.equal(held, true);
  assert.equal(isLeaseExpired(now + 30_000, now), false);
  assert.equal(isLeaseExpired(now + 30_000, now + 30_001), true);

  const lease = await readWorkerLease(store);
  assert.deepEqual(lease, { ownerId: 'other-tab', expiresAt: now + 30_000 });

  let flushed = false;
  let stopped = false;
  await assert.rejects(
    prepareForUpdate(store, {
      flushDrafts: () => {
        flushed = true;
        return Promise.resolve();
      },
      stopQueue: () => {
        stopped = true;
        return Promise.resolve();
      },
      ownerId: 'this-tab',
      clock: () => now,
    }),
    (error: unknown) =>
      error instanceof SignOutBlockedError && error.code === 'update-blocked',
  );
  assert.equal(flushed, true);
  assert.equal(stopped, true);

  // After expiry the same tab may take over and the update closes the store.
  now += 60_000;
  const storeOptions = backend.options();
  await prepareForUpdate(store, {
    flushDrafts: () => Promise.resolve(),
    stopQueue: () => Promise.resolve(),
    ownerId: 'this-tab',
    clock: () => now,
  });
  const reopened = await openLocalStore(origin, storeOptions);
  await reopened.close();
});
