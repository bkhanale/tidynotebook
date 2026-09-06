/**
 * Unit tests for history, checkpoint, branch, restore, and purge services.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyActor, type Actor, type Role } from '../identity/actor.ts';
import { contentDigest } from '../files/digest.ts';
import {
  createCheckpoint,
  listHistory,
  resolveBranches,
  restoreRevision,
  submitBranch,
} from './service.ts';
import { previewPurge, purgeFiles } from './purge.ts';
import {
  ok,
  type AcceptedChangeset,
  type AcceptedRevision,
  type ChangesetInput,
  type Result,
} from '../files/model.ts';
import type {
  AcceptedBranch,
  BranchFilter,
  BranchRecord,
  FilePage,
  FileRecord,
  HistoryPage,
  HistoryRevision,
  MutationReceipt,
  PageRequest,
  PurgePreview,
  PurgedFilesResult,
  RevisionRecord,
  SubmitBranchInput,
  WorkspaceStore,
  WorkspaceTransaction,
} from '../files/ports.ts';

const workspaceId = 'w0000000-0000-4000-8000-000000000001';
const ownerId = 'a0000000-0000-4000-8000-000000000001';
const writerId = 'a0000000-0000-4000-8000-000000000002';
const strangerId = 'a0000000-0000-4000-8000-000000000003';

function buildActor(accountId: string, role: Role | null): Actor {
  const actions: ('read' | 'write')[] =
    role === 'owner' || role === 'editor'
      ? ['read', 'write']
      : role === 'viewer'
        ? ['read']
        : [];
  const built = verifyActor(accountId, [{ workspaceId, actions }]);
  if (!built.ok) throw new Error('Actor creation failed');
  return built.value;
}

class FakeWorkspace {
  readonly roles = new Map<string, Role>();
  readonly files = new Map<string, FileRecord>();
  readonly revisions = new Map<string, RevisionRecord>();
  readonly receipts = new Map<string, MutationReceipt<unknown>>();
  readonly purged = new Set<string>();
  readonly branches: BranchRecord[] = [];
  readonly history: HistoryRevision[] = [];

  constructor() {
    this.roles.set(ownerId, 'owner');
    this.roles.set(writerId, 'editor');
  }
}

function fakeStore(state: FakeWorkspace): WorkspaceStore {
  const tx: WorkspaceTransaction = {
    role: (id: string) => Promise.resolve(state.roles.get(id) ?? null),
    receipt: <T = AcceptedChangeset>(mutationId: string, id: string) =>
      Promise.resolve(
        (state.receipts.get(`${id}:${mutationId}`) as
          MutationReceipt<T> | undefined) ?? null,
      ),
    heads: (fileIds: readonly string[]) =>
      Promise.resolve(
        new Map(
          fileIds.map((fileId) => [
            fileId,
            state.files.get(fileId)?.headRevisionId ?? null,
          ]),
        ),
      ),
    parents: (ids: readonly string[]) =>
      Promise.resolve(
        new Map(
          ids.flatMap((id) => {
            const rev = state.revisions.get(id);
            return rev === undefined ? [] : [[id, rev.fileId]];
          }),
        ),
      ),
    purgedFiles: (fileIds: readonly string[]) =>
      Promise.resolve(fileIds.filter((fileId) => state.purged.has(fileId))),
    listFiles: (_page: PageRequest): Promise<FilePage> =>
      Promise.resolve({
        files: [...state.files.values()].filter((f) => !f.deleted),
        nextCursor: null,
      }),
    file: (fileId: string) => Promise.resolve(state.files.get(fileId) ?? null),
    revision: (revisionId: string) =>
      Promise.resolve(state.revisions.get(revisionId) ?? null),
    accept: (
      writer: Actor,
      input: ChangesetInput,
      _digest: string,
    ): Promise<Result<AcceptedChangeset>> => {
      const acceptedRev = input.revisions.map((r) => {
        state.revisions.set(r.id, {
          revisionId: r.id,
          fileId: r.fileId,
          path: r.path,
          kind: r.content.kind === 'markdown' ? 'note' : 'attachment',
          deleted: r.deleted,
          parents: [...r.parents],
          digest: r.content.digest,
          size: r.content.kind === 'markdown' ? r.content.text.length : 100,
          text: r.content.kind === 'markdown' ? r.content.text : null,
          objectId: r.content.kind === 'attachment' ? r.content.objectId : null,
          message: r.message,
          restoredFrom: r.restoredFrom,
          clientTime: r.clientTime,
          serverTime: new Date().toISOString(),
        });
        state.files.set(r.fileId, {
          fileId: r.fileId,
          path: r.path,
          kind: r.content.kind === 'markdown' ? 'note' : 'attachment',
          headRevisionId: r.id,
          deleted: r.deleted,
          updatedAt: new Date().toISOString(),
        });
        const accepted: AcceptedRevision = {
          revisionId: r.id,
          fileId: r.fileId,
          parents: [...r.parents],
          path: r.path,
          deleted: r.deleted,
          digest: r.content.digest,
          size: r.content.kind === 'markdown' ? r.content.text.length : 100,
          actorAccountId: writer.accountId,
          serverTime: new Date().toISOString(),
          message: r.message,
        };
        return accepted;
      });
      return Promise.resolve(
        ok({
          mutationId: input.mutationId,
          revisionIds: acceptedRev.map((r) => r.revisionId),
          cursor: '1',
          revisions: acceptedRev,
        }),
      );
    },
    onFilesDeleted: (_fileIds: readonly string[]) => Promise.resolve(),
    listHistory: (fileId: string, _page: PageRequest): Promise<HistoryPage> =>
      Promise.resolve({
        revisions: state.history.filter((h) => h.fileId === fileId),
        nextCursor: null,
      }),
    listBranches: (filter?: BranchFilter): Promise<readonly BranchRecord[]> => {
      let result = [...state.branches];
      if (filter?.fileId) {
        result = result.filter((b) => b.fileId === filter.fileId);
      }
      if (filter?.conflictGroupId) {
        result = result.filter(
          (b) => b.conflictGroupId === filter.conflictGroupId,
        );
      }
      if (filter?.state) {
        result = result.filter((b) => b.state === filter.state);
      }
      return Promise.resolve(result);
    },
    markBranchesResolved: (
      branchTipRevisionIds: readonly string[],
    ): Promise<readonly string[]> => {
      const resolved: string[] = [];
      for (let index = 0; index < state.branches.length; index += 1) {
        const branch = state.branches[index];
        if (
          branch !== undefined &&
          branchTipRevisionIds.includes(branch.tipRevisionId) &&
          branch.state === 'unresolved'
        ) {
          state.branches[index] = { ...branch, state: 'resolved' };
          resolved.push(branch.id);
        }
      }
      return Promise.resolve(resolved);
    },
    acceptBranch: (
      _writer: Actor,
      input: SubmitBranchInput,
      _digest: string,
    ): Promise<Result<AcceptedBranch>> => {
      const createdBranches: BranchRecord[] = [];
      for (const rev of input.revisions) {
        state.revisions.set(rev.id, {
          revisionId: rev.id,
          fileId: rev.fileId,
          path: rev.path,
          kind: rev.content.kind === 'markdown' ? 'note' : 'attachment',
          deleted: rev.deleted,
          parents: [...rev.parents],
          digest: rev.content.digest,
          size: rev.content.kind === 'markdown' ? rev.content.text.length : 100,
          text: rev.content.kind === 'markdown' ? rev.content.text : null,
          objectId:
            rev.content.kind === 'attachment' ? rev.content.objectId : null,
          message: rev.message,
          restoredFrom: rev.restoredFrom,
          clientTime: rev.clientTime,
          serverTime: new Date().toISOString(),
        });
        const branchRecord: BranchRecord = {
          id: `branch-${rev.id}`,
          workspaceId: input.workspaceId,
          fileId: rev.fileId,
          baseRevisionId: input.expectedHeads[rev.fileId] ?? null,
          tipRevisionId: rev.id,
          conflictGroupId: input.conflictGroupId,
          state: 'unresolved',
          createdAt: new Date().toISOString(),
        };
        state.branches.push(branchRecord);
        createdBranches.push(branchRecord);
      }
      return Promise.resolve(
        ok({
          mutationId: input.mutationId,
          conflictGroupId: input.conflictGroupId,
          revisionIds: input.revisions.map((r) => r.id),
          branches: createdBranches,
        }),
      );
    },
    previewPurge: (fileIds: readonly string[]): Promise<Result<PurgePreview>> =>
      Promise.resolve(
        ok({
          fileIds: [...fileIds],
          revisionIds: [],
          contentDigests: [],
          attachmentObjectIds: [],
          blockingReferences: [],
          dependentRevisionCount: 0,
          reclaimableBytes: fileIds.length * 512,
          canPurge: true,
        }),
      ),
    purgeFiles: (
      _actor: Actor,
      mutationId: string,
      fileIds: readonly string[],
      _digest: string,
    ): Promise<Result<PurgedFilesResult>> => {
      for (const fileId of fileIds) {
        state.files.delete(fileId);
        state.purged.add(fileId);
      }
      return Promise.resolve(
        ok({
          mutationId,
          purgedFileIds: [...fileIds],
          purgedRevisionIds: [],
          reclaimedBytes: fileIds.length * 512,
        }),
      );
    },
  };

  return {
    transact: <T>(
      _actor: Actor,
      _wsId: string,
      fn: (t: WorkspaceTransaction) => Promise<T>,
    ) => fn(tx),
  };
}

await test('listHistory: rejects stranger or non-member', async () => {
  const state = new FakeWorkspace();
  const store = fakeStore(state);
  const stranger = buildActor(strangerId, null);

  const res = await listHistory(store, stranger, workspaceId, 'f1');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'forbidden');
});

await test('listHistory: rejects purged file with purged error', async () => {
  const state = new FakeWorkspace();
  state.purged.add('f1');
  const store = fakeStore(state);
  const user = buildActor(ownerId, 'owner');

  const res = await listHistory(store, user, workspaceId, 'f1');
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'purged');
    assert.deepEqual(res.error.fileIds, ['f1']);
  }
});

await test('listHistory: returns history page for existing file', async () => {
  const state = new FakeWorkspace();
  state.files.set('f1', {
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    headRevisionId: 'r1',
    deleted: false,
    updatedAt: new Date().toISOString(),
  });
  state.history.push({
    revisionId: 'r1',
    fileId: 'f1',
    path: 'note.md',
    deleted: false,
    parents: [],
    digest: 'abc',
    size: 10,
    actorAccountId: ownerId,
    clientTime: new Date().toISOString(),
    serverTime: new Date().toISOString(),
    message: 'Initial',
    isCheckpoint: true,
    checkpointName: 'Initial',
    restoredFrom: null,
    text: 'content',
    objectId: null,
  });
  const store = fakeStore(state);
  const user = buildActor(ownerId, 'owner');

  const res = await listHistory(store, user, workspaceId, 'f1');
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.revisions.length, 1);
    assert.equal(res.value.revisions[0]?.isCheckpoint, true);
    assert.equal(res.value.revisions[0]?.checkpointName, 'Initial');
  }
});

await test('createCheckpoint: creates named revision preserving content and path', async () => {
  const state = new FakeWorkspace();
  const digest = await contentDigest('test content');
  state.files.set('f1', {
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    headRevisionId: 'r1',
    deleted: false,
    updatedAt: new Date().toISOString(),
  });
  state.revisions.set('r1', {
    revisionId: 'r1',
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    deleted: false,
    parents: [],
    digest,
    size: 12,
    text: 'test content',
    objectId: null,
    message: null,
    restoredFrom: null,
    clientTime: new Date().toISOString(),
    serverTime: new Date().toISOString(),
  });
  const store = fakeStore(state);
  const user = buildActor(writerId, 'editor');

  const res = await createCheckpoint(
    store,
    user,
    {
      workspaceId,
      fileId: 'f1',
      revisionId: 'r2',
      expectedHead: 'r1',
      name: 'v1.0 milestone',
      ids: {
        mutationId: 'm1',
        deviceId: 'd1',
        clientTime: new Date().toISOString(),
      },
    },
    'req-digest',
  );

  assert.equal(res.ok, true);
  const newRev = state.revisions.get('r2');
  assert.ok(newRev);
  assert.equal(newRev.message, 'v1.0 milestone');
  assert.equal(newRev.digest, digest);
  assert.deepEqual(newRev.parents, ['r1']);
});

await test('submitBranch: stores branch revision without advancing accepted head', async () => {
  const state = new FakeWorkspace();
  const text = 'branch draft';
  const digest = await contentDigest(text);
  state.files.set('f1', {
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    headRevisionId: 'r1',
    deleted: false,
    updatedAt: new Date().toISOString(),
  });
  state.revisions.set('r1', {
    revisionId: 'r1',
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    deleted: false,
    parents: [],
    digest: 'old',
    size: 3,
    text: 'old',
    objectId: null,
    message: null,
    restoredFrom: null,
    clientTime: new Date().toISOString(),
    serverTime: new Date().toISOString(),
  });
  const store = fakeStore(state);
  const user = buildActor(writerId, 'editor');

  const res = await submitBranch(
    store,
    user,
    {
      workspaceId,
      mutationId: 'm-branch',
      deviceId: 'd1',
      conflictGroupId: 'cg-1',
      expectedHeads: { f1: 'r1' },
      revisions: [
        {
          id: 'b-rev1',
          fileId: 'f1',
          parents: ['r1'],
          path: 'note.md',
          deleted: false,
          content: { kind: 'markdown', digest, text },
          clientTime: new Date().toISOString(),
          message: 'Divergent edit',
          restoredFrom: null,
        },
      ],
    },
    'req-branch',
  );

  assert.equal(res.ok, true);
  // File head revision must remain r1, not b-rev1
  assert.equal(state.files.get('f1')?.headRevisionId, 'r1');
  assert.equal(state.branches.length, 1);
  assert.equal(state.branches[0]?.tipRevisionId, 'b-rev1');
  assert.equal(state.branches[0]?.state, 'unresolved');
});

await test('resolveBranches: merges two parents and marks branch resolved', async () => {
  const state = new FakeWorkspace();
  const text = 'merged content';
  const digest = await contentDigest(text);

  state.files.set('f1', {
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    headRevisionId: 'r1',
    deleted: false,
    updatedAt: new Date().toISOString(),
  });
  state.revisions.set('r1', {
    revisionId: 'r1',
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    deleted: false,
    parents: [],
    digest: 'd1',
    size: 5,
    text: 'head1',
    objectId: null,
    message: null,
    restoredFrom: null,
    clientTime: new Date().toISOString(),
    serverTime: new Date().toISOString(),
  });
  state.revisions.set('b-rev1', {
    revisionId: 'b-rev1',
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    deleted: false,
    parents: ['r0'],
    digest: 'd2',
    size: 5,
    text: 'branch',
    objectId: null,
    message: null,
    restoredFrom: null,
    clientTime: new Date().toISOString(),
    serverTime: new Date().toISOString(),
  });
  state.branches.push({
    id: 'br-1',
    workspaceId,
    fileId: 'f1',
    baseRevisionId: 'r0',
    tipRevisionId: 'b-rev1',
    conflictGroupId: 'cg-1',
    state: 'unresolved',
    createdAt: new Date().toISOString(),
  });

  const store = fakeStore(state);
  const user = buildActor(writerId, 'editor');

  const res = await resolveBranches(
    store,
    user,
    {
      workspaceId,
      mutationId: 'm-resolve',
      deviceId: 'd1',
      clientTime: new Date().toISOString(),
      conflictGroupId: 'cg-1',
      resolutions: [
        {
          fileId: 'f1',
          expectedHead: 'r1',
          branchTip: 'b-rev1',
          revisionId: 'merge-rev',
          path: 'note.md',
          content: { kind: 'markdown', digest, text },
          deleted: false,
        },
      ],
    },
    'req-resolve',
  );

  assert.equal(res.ok, true);
  const mergeRev = state.revisions.get('merge-rev');
  assert.ok(mergeRev);
  assert.deepEqual(mergeRev.parents, ['r1', 'b-rev1']);
  assert.equal(state.files.get('f1')?.headRevisionId, 'merge-rev');
  assert.equal(state.branches[0]?.state, 'resolved');
});

await test('restoreRevision: creates child revision referencing historic revision without rewriting history', async () => {
  const state = new FakeWorkspace();
  const text0 = 'version zero';
  const digest0 = await contentDigest(text0);

  state.files.set('f1', {
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    headRevisionId: 'r2',
    deleted: false,
    updatedAt: new Date().toISOString(),
  });
  state.revisions.set('r0', {
    revisionId: 'r0',
    fileId: 'f1',
    path: 'old-path.md',
    kind: 'note',
    deleted: false,
    parents: [],
    digest: digest0,
    size: text0.length,
    text: text0,
    objectId: null,
    message: 'Initial',
    restoredFrom: null,
    clientTime: new Date().toISOString(),
    serverTime: new Date().toISOString(),
  });
  state.revisions.set('r2', {
    revisionId: 'r2',
    fileId: 'f1',
    path: 'note.md',
    kind: 'note',
    deleted: false,
    parents: ['r1'],
    digest: 'xyz',
    size: 3,
    text: 'bad',
    objectId: null,
    message: 'Current',
    restoredFrom: null,
    clientTime: new Date().toISOString(),
    serverTime: new Date().toISOString(),
  });

  const store = fakeStore(state);
  const user = buildActor(writerId, 'editor');

  const res = await restoreRevision(
    store,
    user,
    {
      workspaceId,
      fileId: 'f1',
      targetRevisionId: 'r0',
      expectedHead: 'r2',
      revisionId: 'r3',
      ids: {
        mutationId: 'm-restore',
        deviceId: 'd1',
        clientTime: new Date().toISOString(),
      },
    },
    'req-restore',
  );

  assert.equal(res.ok, true);
  const restoredRev = state.revisions.get('r3');
  assert.ok(restoredRev);
  assert.equal(restoredRev.restoredFrom, 'r0');
  assert.equal(restoredRev.digest, digest0);
  assert.deepEqual(restoredRev.parents, ['r2']);
  assert.equal(state.files.get('f1')?.headRevisionId, 'r3');
});

await test('purge: rejects non-owner for preview and execute', async () => {
  const state = new FakeWorkspace();
  const store = fakeStore(state);
  const editor = buildActor(writerId, 'editor');

  const previewRes = await previewPurge(store, editor, workspaceId, ['f1']);
  assert.equal(previewRes.ok, false);
  if (!previewRes.ok) assert.equal(previewRes.error.code, 'forbidden');

  const purgeRes = await purgeFiles(
    store,
    editor,
    workspaceId,
    ['f1'],
    'm-p',
    'req-p',
  );
  assert.equal(purgeRes.ok, false);
  if (!purgeRes.ok) assert.equal(purgeRes.error.code, 'forbidden');
});

await test('purge: owner can purge files successfully and writes purge markers', async () => {
  const state = new FakeWorkspace();
  state.files.set('f1', {
    fileId: 'f1',
    path: '/note.md',
    kind: 'note',
    headRevisionId: 'r1',
    deleted: false,
    updatedAt: new Date().toISOString(),
  });
  const store = fakeStore(state);
  const owner = buildActor(ownerId, 'owner');

  const purgeRes = await purgeFiles(
    store,
    owner,
    workspaceId,
    ['f1'],
    'm-purge',
    'req-purge',
  );
  assert.equal(purgeRes.ok, true);
  if (purgeRes.ok) {
    assert.deepEqual(purgeRes.value.purgedFileIds, ['f1']);
  }
  assert.equal(state.files.has('f1'), false);
  assert.equal(state.purged.has('f1'), true);
});
