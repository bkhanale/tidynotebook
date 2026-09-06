/**
 * Sync engine unit tests.
 *
 * Every test injects a fake `LocalStore` and stubbed network operations, so
 * nothing here touches the network and the generated client is never
 * imported. The integration suite in `tests/integration/sync.test.ts` runs
 * the same engine against the real client and a disposable server.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AcceptedChangeset, ChangesetInput } from '@notesapp/core';
import {
  LocalStorageError,
  type Draft,
  type LocalAcceptedFile,
  type LocalStore,
  type QueueEntry,
  type RecoveryInput,
  type RecoveryRecord,
  type RemoteChange,
  type SnapshotRevision,
} from './local-port.ts';
import { acquireWorkerLease, releaseWorkerLease } from './lease.ts';
import {
  backoffDelay,
  pushQueue,
  type BranchInput,
  type BranchResult,
  type CommitResult,
  type QueueNetwork,
  type SyncContext,
  type SyncNotice,
} from './queue.ts';
import { pullNew, type SnapshotNetwork } from './snapshot.ts';
import { createSyncEngine, type EngineOperations } from './engine.ts';

const accountId = 'account-1';
const workspaceId = 'workspace-1';

/** One staged snapshot of the fake store. */
type Staged = {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly revisionIds: string[];
  readonly cursor: string;
  readonly items: Map<string, SnapshotRevision>;
  state: 'staging' | 'complete' | 'active';
};

/** An in-memory `LocalStore` with controllable time. */
class FakeStore implements LocalStore {
  readonly serverOrigin = 'https://notes.test';
  readonly deviceId = 'device-test';
  nowMs = 1_000_000;
  entries = new Map<string, QueueEntry>();
  order: string[] = [];
  acks: AcceptedChangeset[] = [];
  cursors = new Map<string, string>();
  staged = new Map<string, Staged>();
  lease: { ownerId: string; expiresAt: number } | null = null;
  drafts = new Map<string, Draft>();
  recovery: RecoveryRecord[] = [];
  recoverySeq = 1;
  markers = new Set<string>();
  applied: {
    readonly changes: readonly RemoteChange[];
    readonly nextCursor: string;
  }[] = [];

  private key(account: string, workspace: string): string {
    return `${account}/${workspace}`;
  }

  enqueue(entry: QueueEntry): void {
    this.entries.set(entry.input.mutationId, entry);
    this.order.push(entry.input.mutationId);
  }

  queued(): QueueEntry | null {
    const id = this.order[0];
    if (id === undefined) return null;
    return this.entries.get(id) ?? null;
  }

  async saveDraft(draft: Draft): Promise<void> {
    this.drafts.set(draft.workingCopyId, draft);
  }

  readDraft(
    account: string,
    workspace: string,
    workingCopyId: string,
  ): Promise<Draft | null> {
    const draft = this.drafts.get(workingCopyId) ?? null;
    if (
      draft === null ||
      draft.accountId !== account ||
      draft.workspaceId !== workspace
    )
      return Promise.resolve(null);
    return Promise.resolve(draft);
  }

  checkpoint(): Promise<QueueEntry | null> {
    throw new Error('FakeStore.checkpoint is never used');
  }

  pending(account: string, workspace: string): Promise<readonly QueueEntry[]> {
    const found: QueueEntry[] = [];
    for (const id of this.order) {
      const entry = this.entries.get(id);
      if (
        entry !== undefined &&
        entry.accountId === account &&
        entry.input.workspaceId === workspace
      )
        found.push(entry);
    }
    return Promise.resolve(found);
  }

  markSending(
    _account: string,
    mutationId: string,
    digest: string,
  ): Promise<void> {
    const entry = this.entries.get(mutationId);
    if (entry !== undefined)
      this.entries.set(mutationId, {
        ...entry,
        state: 'sending',
        digest: entry.digest ?? digest,
      });
    return Promise.resolve();
  }

  markConflict(_account: string, mutationId: string): Promise<void> {
    const entry = this.entries.get(mutationId);
    if (entry !== undefined)
      this.entries.set(mutationId, { ...entry, state: 'conflict' });
    return Promise.resolve();
  }

  acknowledge(_account: string, result: AcceptedChangeset): Promise<void> {
    if (!this.entries.has(result.mutationId)) return Promise.resolve();
    this.entries.delete(result.mutationId);
    this.order = this.order.filter((id) => id !== result.mutationId);
    this.acks.push(result);
    return Promise.resolve();
  }

  listCheckpoints(): Promise<readonly []> {
    return Promise.resolve([]);
  }

  recover(): Promise<readonly []> {
    return Promise.resolve([]);
  }

  addRecovery(
    account: string,
    workspace: string,
    entry: RecoveryInput,
  ): Promise<RecoveryRecord> {
    const record: RecoveryRecord = {
      serverOrigin: this.serverOrigin,
      accountId: account,
      workspaceId: workspace,
      recoveryId: entry.recoveryId ?? `recovery-${String(this.recoverySeq++)}`,
      fileId: entry.fileId,
      path: entry.path,
      text: entry.text,
      reason: entry.reason,
      createdAt: entry.createdAt ?? new Date(this.nowMs).toISOString(),
    };
    this.recovery.push(record);
    return Promise.resolve(record);
  }

  removeRecovery(
    _account: string,
    _workspace: string,
    recoveryId: string,
  ): Promise<void> {
    this.recovery = this.recovery.filter(
      (entry) => entry.recoveryId !== recoveryId,
    );
    return Promise.resolve();
  }

  listAcceptedFiles(): Promise<readonly LocalAcceptedFile[]> {
    return Promise.resolve([]);
  }

  listSearchFiles(): Promise<readonly []> {
    return Promise.resolve([]);
  }

  hasContent(): Promise<boolean> {
    return Promise.resolve(false);
  }

  setAttachmentPinned(): Promise<void> {
    return Promise.resolve();
  }

  isAttachmentPinned(): Promise<boolean> {
    return Promise.resolve(false);
  }

  setHistoryPinned(): Promise<void> {
    return Promise.resolve();
  }

  isHistoryPinned(): Promise<boolean> {
    return Promise.resolve(false);
  }

  setSignOutMarker(account: string): Promise<void> {
    this.markers.add(account);
    return Promise.resolve();
  }

  hasSignOutMarker(account: string): Promise<boolean> {
    return Promise.resolve(this.markers.has(account));
  }

  clearSignOutMarker(account: string): Promise<void> {
    this.markers.delete(account);
    return Promise.resolve();
  }

  clearPrivateData(account: string, workspace?: string): Promise<void> {
    if (workspace === undefined) {
      this.entries.clear();
      this.order = [];
      this.drafts.clear();
      this.recovery = this.recovery.filter(
        (entry) => entry.accountId !== account,
      );
      return Promise.resolve();
    }
    for (const [id, entry] of [...this.entries]) {
      if (
        entry.accountId === account &&
        entry.input.workspaceId === workspace
      ) {
        this.entries.delete(id);
        this.order = this.order.filter((kept) => kept !== id);
      }
    }
    for (const [id, draft] of [...this.drafts]) {
      if (draft.accountId === account && draft.workspaceId === workspace)
        this.drafts.delete(id);
    }
    this.recovery = this.recovery.filter(
      (entry) =>
        !(entry.accountId === account && entry.workspaceId === workspace),
    );
    return Promise.resolve();
  }

  acquireLease(ownerId: string, expiresAt: number): Promise<boolean> {
    if (
      this.lease !== null &&
      this.lease.ownerId !== ownerId &&
      this.lease.expiresAt > this.nowMs
    )
      return Promise.resolve(false);
    this.lease = { ownerId, expiresAt };
    return Promise.resolve(true);
  }

  releaseLease(ownerId: string): Promise<void> {
    if (this.lease?.ownerId === ownerId) this.lease = null;
    return Promise.resolve();
  }

  readLeaseState(): Promise<{
    readonly ownerId: string;
    readonly expiresAt: number;
  } | null> {
    return Promise.resolve(this.lease);
  }

  stageSnapshot(
    account: string,
    workspace: string,
    token: string,
    revisionIds: readonly string[],
    cursor: string,
  ): Promise<void> {
    this.staged.set(token, {
      accountId: account,
      workspaceId: workspace,
      revisionIds: [...revisionIds],
      cursor,
      items: new Map(),
      state: 'staging',
    });
    return Promise.resolve();
  }

  storeSnapshotRevision(
    _account: string,
    _workspace: string,
    revision: SnapshotRevision,
  ): Promise<void> {
    const staged = this.staged.get(revision.token);
    if (staged === undefined)
      throw new LocalStorageError('corrupt', 'no staged snapshot');
    staged.items.set(revision.revisionId, revision);
    return Promise.resolve();
  }

  activateSnapshot(token: string): Promise<void> {
    const staged = this.staged.get(token);
    if (staged === undefined)
      throw new LocalStorageError('corrupt', 'no staged snapshot');
    for (const id of staged.revisionIds) {
      const item = staged.items.get(id);
      if (item === undefined)
        throw new LocalStorageError('aborted', 'the snapshot is incomplete');
      if (!item.deleted && item.kind === 'note' && item.text === null)
        throw new LocalStorageError('aborted', 'the snapshot is incomplete');
    }
    staged.state = 'active';
    this.cursors.set(
      this.key(staged.accountId, staged.workspaceId),
      staged.cursor,
    );
    return Promise.resolve();
  }

  readCursor(account: string, workspace: string): Promise<string | null> {
    return Promise.resolve(
      this.cursors.get(this.key(account, workspace)) ?? null,
    );
  }

  applyRemoteChanges(
    account: string,
    workspace: string,
    changes: readonly RemoteChange[],
    nextCursor: string,
  ): Promise<void> {
    this.applied.push({ changes, nextCursor });
    this.cursors.set(this.key(account, workspace), nextCursor);
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** One queued mutation of one file, pending by default. */
function queuedEntry(
  fileId: string,
  revisionId: string,
  text: string,
  expectedHead: string | null,
  mutationId: string,
): QueueEntry {
  const input: ChangesetInput = {
    workspaceId,
    mutationId,
    deviceId: 'device-test',
    expectedHeads: { [fileId]: expectedHead },
    revisions: [
      {
        id: revisionId,
        fileId,
        parents: [],
        path: `notes/${fileId}.md`,
        deleted: false,
        content: {
          kind: 'markdown',
          digest: `digest-${revisionId}`,
          text,
        },
        clientTime: '2026-09-06T10:00:00.000Z',
        message: null,
        restoredFrom: null,
      },
    ],
  };
  return { accountId, input, state: 'pending', digest: null };
}

/** A stubbed network with recorded calls. */
type Stubs = EngineOperations & {
  readonly commitCalls: ChangesetInput[];
  readonly branchCalls: BranchInput[];
};

function stubOperations(behavior: {
  readonly commit?: (input: ChangesetInput) => Promise<CommitResult>;
  readonly submitBranch?: (input: BranchInput) => Promise<BranchResult>;
  readonly start?: SnapshotNetwork['start'];
  readonly page?: SnapshotNetwork['page'];
  readonly revision?: SnapshotNetwork['revision'];
  readonly changes?: SnapshotNetwork['changes'];
  readonly verifySession?: EngineOperations['verifySession'];
}): Stubs {
  const commitCalls: ChangesetInput[] = [];
  const branchCalls: BranchInput[] = [];
  const queue: QueueNetwork = {
    prepareCommit: (input) => Promise.resolve(`digest-for-${input.mutationId}`),
    commit: (input, _signal) => {
      commitCalls.push(input);
      if (behavior.commit === undefined)
        return Promise.reject(new Error('unexpected commit call'));
      return behavior.commit(input);
    },
    submitBranch: (input, _signal) => {
      branchCalls.push(input);
      if (behavior.submitBranch === undefined)
        return Promise.reject(new Error('unexpected submitBranch call'));
      return behavior.submitBranch(input);
    },
  };
  const snapshot: SnapshotNetwork = {
    start: (_signal) => {
      if (behavior.start === undefined)
        return Promise.reject(new Error('unexpected start call'));
      return behavior.start(_signal);
    },
    page: (token, position, _signal) => {
      if (behavior.page === undefined)
        return Promise.reject(new Error('unexpected page call'));
      return behavior.page(token, position, _signal);
    },
    revision: (revisionId, _signal) => {
      if (behavior.revision === undefined)
        return Promise.reject(new Error('unexpected revision call'));
      return behavior.revision(revisionId, _signal);
    },
    changes: (cursor, _signal) => {
      if (behavior.changes === undefined)
        return Promise.reject(new Error('unexpected changes call'));
      return behavior.changes(cursor, _signal);
    },
  };
  return {
    ...queue,
    ...snapshot,
    verifySession: (_signal) => {
      if (behavior.verifySession === undefined)
        return Promise.resolve({
          ok: true as const,
          value: { accountId },
        });
      return behavior.verifySession(_signal);
    },
    commitCalls,
    branchCalls,
  };
}

/** A context that records announcements and never waits. */
function testContext(
  notices: SyncNotice[],
  delays: number[],
  signal?: AbortSignal,
): SyncContext {
  let nextId = 0;
  return {
    signal: signal ?? new AbortController().signal,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
    id: () => {
      nextId += 1;
      return `id-${String(nextId)}`;
    },
    announce: (notice: SyncNotice) => {
      notices.push(notice);
    },
  };
}

/** Waits until a condition holds, failing loudly on timeout. */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs)
      throw new Error('waitFor timed out before the condition held');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function accepted(
  mutationId: string,
  revisionIds: readonly string[],
  cursor: string,
): AcceptedChangeset {
  return { mutationId, revisionIds: [...revisionIds], revisions: [], cursor };
}

await test('a single entry submits and acknowledges its exact result', async () => {
  const store = new FakeStore();
  store.enqueue(queuedEntry('file-a', 'rev-a', '# A\n', null, 'mutation-1'));
  const notices: SyncNotice[] = [];
  const delays: number[] = [];
  const ops = stubOperations({
    commit: (input) => {
      assert.equal(input.mutationId, 'mutation-1');
      return Promise.resolve({
        ok: true as const,
        value: accepted('mutation-1', ['rev-a'], '7'),
      });
    },
  });
  const outcome = await pushQueue(
    store,
    accountId,
    workspaceId,
    ops,
    testContext(notices, delays),
  );
  assert.equal(outcome, 'done');
  assert.equal(ops.commitCalls.length, 1);
  assert.deepEqual(store.acks, [accepted('mutation-1', ['rev-a'], '7')]);
  assert.deepEqual((await store.pending(accountId, workspaceId)).length, 0);
  assert.deepEqual(notices, [{ kind: 'pushed', mutationIds: ['mutation-1'] }]);
});

await test('the digest freezes on first send and the retry repeats the body', async () => {
  const store = new FakeStore();
  const entry = queuedEntry('file-a', 'rev-a', '# A\n', null, 'mutation-1');
  store.enqueue({ ...entry, state: 'sending', digest: 'frozen-1' });
  const notices: SyncNotice[] = [];
  const delays: number[] = [];
  let attempts = 0;
  const bodies: ChangesetInput[] = [];
  const ops = stubOperations({
    commit: (input) => {
      attempts += 1;
      bodies.push(input);
      if (attempts === 1)
        return Promise.reject(new Error('the response was lost'));
      return Promise.resolve({
        ok: true as const,
        value: accepted('mutation-1', ['rev-a'], '8'),
      });
    },
  });
  const outcome = await pushQueue(
    store,
    accountId,
    workspaceId,
    ops,
    testContext(notices, delays),
  );
  assert.equal(outcome, 'done');
  assert.equal(attempts, 2);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(store.acks, [accepted('mutation-1', ['rev-a'], '8')]);
  assert.deepEqual(notices, [
    { kind: 'retry', attempt: 1, delayMs: 500 },
    { kind: 'pushed', mutationIds: ['mutation-1'] },
  ]);
});

await test('two offline edits of one file commit as one atomic changeset', async () => {
  const store = new FakeStore();
  store.enqueue(queuedEntry('file-a', 'rev-a', '# A\n', null, 'mutation-1'));
  store.enqueue(
    queuedEntry('file-a', 'rev-b', '# A edited\n', null, 'mutation-2'),
  );
  const notices: SyncNotice[] = [];
  const delays: number[] = [];
  const ops = stubOperations({
    commit: (input) =>
      Promise.resolve({
        ok: true as const,
        value: accepted(input.mutationId, ['rev-a', 'rev-b'], '9'),
      }),
  });
  const outcome = await pushQueue(
    store,
    accountId,
    workspaceId,
    ops,
    testContext(notices, delays),
  );
  assert.equal(outcome, 'done');
  assert.equal(ops.commitCalls.length, 1);
  const sent = ops.commitCalls[0];
  assert.ok(sent !== undefined);
  assert.deepEqual(
    sent.revisions.map((revision) => revision.id),
    ['rev-a', 'rev-b'],
  );
  assert.deepEqual(sent.expectedHeads, { 'file-a': null });
  assert.deepEqual(
    store.acks.map((ack) => ack.mutationId),
    ['mutation-1', 'mutation-2'],
  );
  assert.deepEqual((await store.pending(accountId, workspaceId)).length, 0);
});

await test('a stale head submits an explicit branch and keeps the local body', async () => {
  const store = new FakeStore();
  store.enqueue(queuedEntry('file-a', 'rev-b', '# B\n', 'rev-a', 'mutation-2'));
  const notices: SyncNotice[] = [];
  const delays: number[] = [];
  const ops = stubOperations({
    commit: () =>
      Promise.resolve({
        ok: false as const,
        problem: { status: 412, code: 'stale_head', fileIds: ['file-a'] },
      }),
    submitBranch: (input) => {
      assert.notEqual(input.mutationId, 'mutation-2');
      assert.ok(input.conflictGroupId.length > 0);
      assert.deepEqual(input.expectedHeads, { 'file-a': 'rev-a' });
      assert.deepEqual(
        input.revisions.map((revision) => revision.id),
        ['rev-b'],
      );
      return Promise.resolve({
        ok: true as const,
        value: { revisionIds: ['rev-b'] },
      });
    },
  });
  const outcome = await pushQueue(
    store,
    accountId,
    workspaceId,
    ops,
    testContext(notices, delays),
  );
  assert.equal(outcome, 'done');
  assert.equal(ops.branchCalls.length, 1);
  assert.equal(store.acks.length, 0);
  const kept = store.queued();
  assert.ok(kept !== null);
  assert.equal(kept.state, 'conflict');
  assert.equal(kept.input.mutationId, 'mutation-2');
  assert.deepEqual(notices, [
    { kind: 'conflict', mutationId: 'mutation-2', code: 'stale_head' },
  ]);
});

await test('a path collision branches while a purge is preserved without one', async () => {
  for (const problem of [
    { status: 409, code: 'path_conflict', fileIds: ['file-a'] as string[] },
    { status: 410, code: 'purged', fileIds: ['file-a'] as string[] },
  ]) {
    const store = new FakeStore();
    store.enqueue(
      queuedEntry('file-a', 'rev-b', '# B\n', 'rev-a', 'mutation-2'),
    );
    const notices: SyncNotice[] = [];
    const delays: number[] = [];
    const ops = stubOperations({
      commit: () => Promise.resolve({ ok: false as const, problem }),
      submitBranch: () =>
        Promise.resolve({
          ok: true as const,
          value: { revisionIds: ['rev-b'] },
        }),
    });
    const outcome = await pushQueue(
      store,
      accountId,
      workspaceId,
      ops,
      testContext(notices, delays),
    );
    assert.equal(outcome, 'done');
    const kept = store.queued();
    assert.ok(kept !== null);
    assert.equal(kept.state, 'conflict');
    assert.equal(kept.input.mutationId, 'mutation-2');
    if (problem.code === 'path_conflict') {
      assert.equal(ops.branchCalls.length, 1);
      assert.deepEqual(notices, [
        { kind: 'conflict', mutationId: 'mutation-2', code: 'path_conflict' },
      ]);
    } else {
      assert.equal(ops.branchCalls.length, 0);
      assert.deepEqual(notices, [
        { kind: 'preserved', mutationId: 'mutation-2', code: 'purged' },
      ]);
    }
  }
});

await test('an invalid graph is preserved after exactly one attempt', async () => {
  const store = new FakeStore();
  store.enqueue(queuedEntry('file-a', 'rev-b', '# B\n', 'rev-a', 'mutation-2'));
  const notices: SyncNotice[] = [];
  const delays: number[] = [];
  const ops = stubOperations({
    commit: () =>
      Promise.resolve({
        ok: false as const,
        problem: { status: 422, code: 'invalid_graph', fileIds: ['file-a'] },
      }),
  });
  const outcome = await pushQueue(
    store,
    accountId,
    workspaceId,
    ops,
    testContext(notices, delays),
  );
  assert.equal(outcome, 'done');
  assert.equal(ops.commitCalls.length, 1);
  assert.equal(ops.branchCalls.length, 0);
  assert.equal(store.queued()?.state, 'conflict');
  assert.deepEqual(notices, [
    { kind: 'preserved', mutationId: 'mutation-2', code: 'invalid_graph' },
  ]);
});

await test('an expired session pauses and a lost workspace stops the push', async () => {
  for (const problem of [
    { status: 401, code: 'unauthorized', fileIds: [] as string[] },
    { status: 403, code: 'forbidden', fileIds: [] as string[] },
  ]) {
    const store = new FakeStore();
    store.enqueue(queuedEntry('file-a', 'rev-a', '# A\n', null, 'mutation-1'));
    const ops = stubOperations({
      commit: () => Promise.resolve({ ok: false as const, problem }),
    });
    const outcome = await pushQueue(
      store,
      accountId,
      workspaceId,
      ops,
      testContext([], []),
    );
    assert.equal(outcome, problem.status === 401 ? 'paused' : 'access-lost');
    assert.equal(store.acks.length, 0);
    // The digest froze on first send even though the answer refused the
    // write, so a retry repeats the same operation.
    assert.equal(store.queued()?.state, 'sending');
    assert.equal(store.queued()?.digest, 'digest-for-mutation-1');
  }
});

await test('transport failures back off with bounded delays and then defer', async () => {
  const store = new FakeStore();
  store.enqueue(queuedEntry('file-a', 'rev-a', '# A\n', null, 'mutation-1'));
  const notices: SyncNotice[] = [];
  const delays: number[] = [];
  const ops = stubOperations({
    commit: () => Promise.reject(new Error('the network is down')),
  });
  const outcome = await pushQueue(
    store,
    accountId,
    workspaceId,
    ops,
    testContext(notices, delays),
  );
  assert.equal(outcome, 'deferred');
  assert.equal(ops.commitCalls.length, 4);
  assert.deepEqual(delays, [500, 1000, 2000]);
  for (const delay of delays) assert.ok(delay <= 8500);
  assert.equal(store.queued()?.state, 'sending');
});

await test('backoff delays grow exponentially within the cap', async () => {
  assert.equal(
    backoffDelay(0, () => 0),
    500,
  );
  assert.equal(
    backoffDelay(1, () => 0),
    1000,
  );
  assert.equal(
    backoffDelay(2, () => 0),
    2000,
  );
  assert.equal(
    backoffDelay(10, () => 0),
    8000,
  );
  assert.equal(
    backoffDelay(0, () => 0.999),
    999,
  );
  assert.ok(backoffDelay(3, () => 0.5) <= 8500);
});

await test('the first pull stages, fetches, and activates a snapshot', async () => {
  const store = new FakeStore();
  const notices: SyncNotice[] = [];
  const delays: number[] = [];
  const ops = stubOperations({
    start: () =>
      Promise.resolve({
        ok: true as const,
        value: { token: 'token-1', cursor: '100', itemCount: 1 },
      }),
    page: (token, position) => {
      assert.equal(token, 'token-1');
      assert.equal(position, 0);
      return Promise.resolve({
        ok: true as const,
        value: {
          token: 'token-1',
          cursor: '100',
          items: [
            {
              fileId: 'file-a',
              revisionId: 'rev-a',
              path: 'notes/a.md',
              fileKind: 'note' as const,
              deleted: false,
            },
          ],
          nextPosition: null,
        },
      });
    },
    revision: (revisionId) => {
      assert.equal(revisionId, 'rev-a');
      return Promise.resolve({
        ok: true as const,
        value: {
          fileId: 'file-a',
          revisionId: 'rev-a',
          path: 'notes/a.md',
          fileKind: 'note' as const,
          deleted: false,
          digest: 'digest-a',
          text: '# A\n',
        },
      });
    },
    changes: (cursor) => {
      assert.equal(cursor, '100');
      return Promise.resolve({
        ok: true as const,
        value: { changes: [], nextCursor: '100' },
      });
    },
  });
  const outcome = await pullNew(
    store,
    accountId,
    workspaceId,
    ops,
    testContext(notices, delays),
  );
  assert.equal(outcome, 'done');
  assert.equal(await store.readCursor(accountId, workspaceId), '100');
  assert.equal(store.staged.get('token-1')?.state, 'active');
  assert.deepEqual(notices, [{ kind: 'snapshot-activated', count: 1 }]);
});

await test('an expired cursor restarts from a fresh snapshot and keeps the queue', async () => {
  const store = new FakeStore();
  store.cursors.set(`${accountId}/${workspaceId}`, '0');
  store.enqueue(queuedEntry('file-a', 'rev-a', '# A\n', null, 'mutation-1'));
  const notices: SyncNotice[] = [];
  const delays: number[] = [];
  let starts = 0;
  const ops = stubOperations({
    changes: (cursor) => {
      if (cursor === '0')
        return Promise.resolve({
          ok: false as const,
          problem: { status: 410, code: 'snapshot_required', fileIds: [] },
        });
      return Promise.resolve({
        ok: true as const,
        value: { changes: [], nextCursor: cursor },
      });
    },
    start: () => {
      starts += 1;
      return Promise.resolve({
        ok: true as const,
        value: { token: `token-${String(starts)}`, cursor: '50', itemCount: 0 },
      });
    },
    page: (token) =>
      Promise.resolve({
        ok: true as const,
        value: { token, cursor: '50', items: [], nextPosition: null },
      }),
  });
  const outcome = await pullNew(
    store,
    accountId,
    workspaceId,
    ops,
    testContext(notices, delays),
  );
  assert.equal(outcome, 'done');
  assert.equal(starts, 1);
  assert.equal(await store.readCursor(accountId, workspaceId), '50');
  assert.deepEqual(
    notices.filter((notice) => notice.kind === 'snapshot-restart').length,
    1,
  );
  assert.equal(store.queued()?.input.mutationId, 'mutation-1');
});

await test('a purged revision mid-download restarts the snapshot once', async () => {
  const store = new FakeStore();
  const notices: SyncNotice[] = [];
  const delays: number[] = [];
  let starts = 0;
  const ops = stubOperations({
    start: () => {
      starts += 1;
      return Promise.resolve({
        ok: true as const,
        value: { token: `token-${String(starts)}`, cursor: '60', itemCount: 1 },
      });
    },
    page: (token) =>
      Promise.resolve({
        ok: true as const,
        value: {
          token,
          cursor: '60',
          items: [
            {
              fileId: 'file-a',
              revisionId: token === 'token-1' ? 'rev-gone' : 'rev-a',
              path: 'notes/a.md',
              fileKind: 'note' as const,
              deleted: false,
            },
          ],
          nextPosition: null,
        },
      }),
    revision: (revisionId) => {
      if (revisionId === 'rev-gone')
        return Promise.resolve({
          ok: false as const,
          problem: { status: 410, code: 'purged', fileIds: ['file-a'] },
        });
      return Promise.resolve({
        ok: true as const,
        value: {
          fileId: 'file-a',
          revisionId: 'rev-a',
          path: 'notes/a.md',
          fileKind: 'note' as const,
          deleted: false,
          digest: 'digest-a',
          text: '# A\n',
        },
      });
    },
    changes: (cursor) =>
      Promise.resolve({
        ok: true as const,
        value: { changes: [], nextCursor: cursor },
      }),
  });
  const outcome = await pullNew(
    store,
    accountId,
    workspaceId,
    ops,
    testContext(notices, delays),
  );
  assert.equal(outcome, 'done');
  assert.equal(starts, 2);
  assert.equal(await store.readCursor(accountId, workspaceId), '60');
  assert.equal(store.staged.get('token-2')?.state, 'active');
});

await test('a second worker never syncs while the lease is held', async () => {
  const store = new FakeStore();
  store.enqueue(queuedEntry('file-a', 'rev-a', '# A\n', null, 'mutation-1'));
  const first: SyncNotice[] = [];
  const second: SyncNotice[] = [];
  const firstOps = stubOperations({
    commit: (input) =>
      Promise.resolve({
        ok: true as const,
        value: accepted(input.mutationId, ['rev-a'], '11'),
      }),
    changes: (cursor) =>
      Promise.resolve({
        ok: true as const,
        value: { changes: [], nextCursor: cursor },
      }),
  });
  const secondOps = stubOperations({
    commit: () => Promise.reject(new Error('the second worker must not send')),
  });
  const firstEngine = createSyncEngine(store, accountId, workspaceId, {
    ownerId: 'owner-first',
    operations: firstOps,
    announce: (notice) => {
      first.push(notice);
    },
    pollIntervalMs: 5,
    leaseTtlMs: 60_000,
    random: () => 0,
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException('stopped', 'AbortError'));
          return;
        }
        setTimeout(resolve, ms);
      }),
  });
  const firstController = new AbortController();
  const firstRunning = firstEngine.run(firstController.signal);
  await waitFor(() => store.acks.length === 1);
  const secondEngine = createSyncEngine(store, accountId, workspaceId, {
    ownerId: 'owner-second',
    operations: secondOps,
    announce: (notice) => {
      second.push(notice);
    },
    pollIntervalMs: 5,
    leaseTtlMs: 60_000,
    random: () => 0,
  });
  await secondEngine.run(new AbortController().signal);
  assert.deepEqual(second, [{ kind: 'lease-held' }]);
  firstController.abort();
  await firstRunning;
  assert.equal(store.lease, null);
});

await test('an expired session pauses the run without sending anything', async () => {
  const store = new FakeStore();
  store.enqueue(queuedEntry('file-a', 'rev-a', '# A\n', null, 'mutation-1'));
  const notices: SyncNotice[] = [];
  const ops = stubOperations({
    verifySession: () =>
      Promise.resolve({
        ok: false as const,
        problem: { status: 401, code: 'unauthorized', fileIds: [] },
      }),
    commit: () => Promise.reject(new Error('nothing may be sent paused')),
  });
  const engine = createSyncEngine(store, accountId, workspaceId, {
    ownerId: 'owner-1',
    operations: ops,
    announce: (notice) => {
      notices.push(notice);
    },
    pollIntervalMs: 5,
    leaseTtlMs: 60_000,
    random: () => 0,
  });
  const controller = new AbortController();
  const running = engine.run(controller.signal);
  await waitFor(() => notices.some((notice) => notice.kind === 'paused'));
  assert.equal(ops.commitCalls.length, 0);
  assert.equal(store.queued()?.state, 'pending');
  controller.abort();
  await running;
  assert.equal(store.lease, null);
});

await test('a viewer downgrade suspends writes but keeps reads, then recovers', async () => {
  const store = new FakeStore();
  store.enqueue(queuedEntry('file-a', 'rev-a', '# A\n', null, 'mutation-1'));
  store.cursors.set(`${accountId}/${workspaceId}`, '20');
  const notices: SyncNotice[] = [];
  let editor = false;
  let commits = 0;
  const ops = stubOperations({
    commit: (input) => {
      commits += 1;
      if (!editor)
        return Promise.resolve({
          ok: false as const,
          problem: { status: 403, code: 'forbidden', fileIds: [] },
        });
      return Promise.resolve({
        ok: true as const,
        value: accepted(input.mutationId, ['rev-a'], '21'),
      });
    },
    changes: (cursor) =>
      Promise.resolve({
        ok: true as const,
        value: { changes: [], nextCursor: cursor },
      }),
  });
  const engine = createSyncEngine(store, accountId, workspaceId, {
    ownerId: 'owner-1',
    operations: ops,
    announce: (notice) => {
      notices.push(notice);
    },
    pollIntervalMs: 5,
    leaseTtlMs: 60_000,
    random: () => 0,
  });
  const controller = new AbortController();
  const running = engine.run(controller.signal);
  await waitFor(() =>
    notices.some((notice) => notice.kind === 'role-downgraded'),
  );
  // Writes wait while reads continue: the entry stays queued and the change
  // poll keeps running.
  assert.equal(store.queued()?.input.mutationId, 'mutation-1');
  assert.ok(commits >= 1);
  assert.equal(store.acks.length, 0);
  editor = true;
  await waitFor(() => store.acks.length === 1);
  assert.ok(
    notices.some((notice) => notice.kind === 'writes-resumed'),
    'the restored role must resume writes',
  );
  controller.abort();
  await running;
  assert.deepEqual(store.acks, [accepted('mutation-1', ['rev-a'], '21')]);
});

await test('the worker lease is exclusive, renewable, and taken over on expiry', async () => {
  const store = new FakeStore();
  store.nowMs = 1_000_000;
  assert.equal(
    await acquireWorkerLease(store, {
      ownerId: 'owner-a',
      ttlMs: 1000,
      clock: () => store.nowMs,
    }),
    true,
  );
  assert.equal(
    await acquireWorkerLease(store, {
      ownerId: 'owner-b',
      ttlMs: 1000,
      clock: () => store.nowMs,
    }),
    false,
  );
  assert.equal(
    await acquireWorkerLease(store, {
      ownerId: 'owner-a',
      ttlMs: 1000,
      clock: () => store.nowMs,
    }),
    true,
  );
  store.nowMs += 2000;
  assert.equal(
    await acquireWorkerLease(store, {
      ownerId: 'owner-b',
      ttlMs: 1000,
      clock: () => store.nowMs,
    }),
    true,
  );
  await releaseWorkerLease(store, 'owner-a');
  assert.notEqual(store.lease, null);
  await releaseWorkerLease(store, 'owner-b');
  assert.equal(store.lease, null);
});
