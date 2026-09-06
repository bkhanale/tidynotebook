/**
 * The rules of `commitChangeset`, against an in-memory workspace.
 *
 * The fake store below keeps the parts of accepted state that the use case
 * reads and writes. It performs no permission check and no path uniqueness
 * check of its own, so every outcome here comes from the use case. The
 * PostgreSQL rules that only storage can enforce are covered by the storage
 * integration tests instead.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyActor, type Actor, type Role } from '../identity/actor.ts';
import { commitChangeset, maxFilesPerChangeset } from './commit.ts';
import { contentDigest } from './digest.ts';
import type {
  AcceptedChangeset,
  ChangesetInput,
  ContentRef,
  Result,
  RevisionInput,
} from './model.ts';
import { fail, ok } from './model.ts';
import type {
  FilePage,
  FileRecord,
  MutationReceipt,
  PageRequest,
  RevisionRecord,
  WorkspaceStore,
  WorkspaceTransaction,
} from './ports.ts';

const workspaceId = 'w0000000-0000-4000-8000-000000000001';
const accountId = 'a0000000-0000-4000-8000-000000000001';

/** A verified actor with the given actions in the test workspace. */
function actorWith(actions: readonly ('read' | 'write')[]): Actor {
  const built = verifyActor(accountId, [{ workspaceId, actions }]);
  if (!built.ok) throw new Error('the test actor was rejected');
  return built.value;
}

/** One stored revision of the fake workspace. */
type StoredRevision = RevisionRecord;

/** The accepted state that the use case reads. */
class FakeWorkspace {
  readonly roles = new Map<string, Role>();
  readonly files = new Map<string, FileRecord>();
  readonly revisions = new Map<string, StoredRevision>();
  readonly receipts = new Map<string, MutationReceipt>();
  readonly purged = new Set<string>();
  /** Every call of `onFilesDeleted`, so a test can prove that it ran. */
  readonly deletions: string[][] = [];
  /** Every changeset that reached `accept`. */
  readonly accepted: ChangesetInput[] = [];
  cursor = 0;
  /** A domain failure that the next `accept` returns instead of writing. */
  refuse: Result<AcceptedChangeset> | null = null;
}

/** Builds the store port over one fake workspace. */
function fakeStore(state: FakeWorkspace): WorkspaceStore {
  const transaction: WorkspaceTransaction = {
    search: () => Promise.resolve([]),
    backlinks: () => Promise.resolve([]),
    isAcceptedRevision: () => Promise.resolve(false),
    createShare: () => Promise.reject(new Error('unused share operation')),
    updateShare: () => Promise.resolve(null),
    revokeShare: () => Promise.resolve(null),
    listShares: () => Promise.resolve([]),
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
            const revision = state.revisions.get(id);
            return revision === undefined ? [] : [[id, revision.fileId]];
          }),
        ),
      ),
    purgedFiles: (fileIds: readonly string[]) =>
      Promise.resolve(fileIds.filter((fileId) => state.purged.has(fileId))),
    listFiles: (page: PageRequest): Promise<FilePage> =>
      Promise.resolve({
        files: [...state.files.values()]
          .filter((file) => !file.deleted)
          .slice(0, page.limit),
        nextCursor: null,
      }),
    file: (fileId: string) => Promise.resolve(state.files.get(fileId) ?? null),
    revision: (revisionId: string) =>
      Promise.resolve(state.revisions.get(revisionId) ?? null),
    accept: (
      writer: Actor,
      input: ChangesetInput,
      digest: string,
    ): Promise<Result<AcceptedChangeset>> => {
      if (state.refuse !== null) return Promise.resolve(state.refuse);
      state.accepted.push(input);
      state.cursor += 1;
      for (const revision of input.revisions) {
        state.revisions.set(revision.id, {
          revisionId: revision.id,
          fileId: revision.fileId,
          path: revision.path,
          kind: revision.content.kind === 'markdown' ? 'note' : 'attachment',
          deleted: revision.deleted,
          parents: [...revision.parents],
          digest: revision.content.digest,
          size:
            revision.content.kind === 'markdown'
              ? revision.content.text.length
              : 0,
          text:
            revision.content.kind === 'markdown' ? revision.content.text : null,
          objectId:
            revision.content.kind === 'attachment'
              ? revision.content.objectId
              : null,
          message: revision.message,
          restoredFrom: revision.restoredFrom,
          clientTime: revision.clientTime,
          serverTime: '2026-09-06T10:00:00.000Z',
        });
        state.files.set(revision.fileId, {
          fileId: revision.fileId,
          path: revision.path,
          kind: revision.content.kind === 'markdown' ? 'note' : 'attachment',
          headRevisionId: revision.id,
          deleted: revision.deleted,
          updatedAt: '2026-09-06T10:00:00.000Z',
        });
      }
      const outcome: AcceptedChangeset = {
        mutationId: input.mutationId,
        revisionIds: input.revisions.map((revision) => revision.id),
        cursor: String(state.cursor),
        revisions: input.revisions.map((revision) => ({
          revisionId: revision.id,
          fileId: revision.fileId,
          parents: [...revision.parents],
          path: revision.path,
          deleted: revision.deleted,
          digest: revision.content.digest,
          size:
            revision.content.kind === 'markdown'
              ? revision.content.text.length
              : 0,
          actorAccountId: writer.accountId,
          serverTime: '2026-09-06T10:00:00.000Z',
          message: revision.message,
        })),
      };
      state.receipts.set(`${writer.accountId}:${input.mutationId}`, {
        digest,
        outcome,
      });
      return Promise.resolve(ok(outcome));
    },
    onFilesDeleted: (fileIds: readonly string[]) => {
      state.deletions.push([...fileIds]);
      return Promise.resolve();
    },
    listHistory: () => Promise.resolve({ revisions: [], nextCursor: null }),
    listBranches: () => Promise.resolve([]),
    markBranchesResolved: () => Promise.resolve([]),
    acceptBranch: () =>
      Promise.resolve(
        ok({
          mutationId: '',
          conflictGroupId: '',
          revisionIds: [],
          branches: [],
        }),
      ),
    previewPurge: () =>
      Promise.resolve(
        ok({
          fileIds: [],
          revisionIds: [],
          contentDigests: [],
          attachmentObjectIds: [],
          blockingReferences: [],
          dependentRevisionCount: 0,
          reclaimableBytes: 0,
          canPurge: true,
        }),
      ),
    purgeFiles: () =>
      Promise.resolve(
        ok({
          mutationId: '',
          purgedFileIds: [],
          purgedRevisionIds: [],
          reclaimedBytes: 0,
        }),
      ),
    startSnapshot: () => Promise.reject(new Error('no snapshot in this test')),
    snapshotPage: () => Promise.resolve(null),
    syncChanges: () =>
      Promise.resolve({ changes: [], highWater: '0', oldestRetained: null }),
  };
  return {
    transact: <T>(
      _actor: Actor,
      _workspaceId: string,
      run: (tx: WorkspaceTransaction) => Promise<T>,
    ): Promise<T> => run(transaction),
  };
}

/** A workspace whose single member holds the given role. */
function workspaceWith(role: Role): FakeWorkspace {
  const state = new FakeWorkspace();
  state.roles.set(accountId, role);
  return state;
}

let counter = 0;

/** A distinct identifier for a test record. */
function id(prefix: string): string {
  counter += 1;
  return `${prefix}0000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

/** Markdown content with a correct digest. */
async function content(text: string): Promise<ContentRef> {
  return { kind: 'markdown', digest: await contentDigest(text), text };
}

/** One revision with test defaults. */
async function revision(
  seed: Partial<RevisionInput> & { fileId: string; path: string },
): Promise<RevisionInput> {
  return {
    id: seed.id ?? id('r'),
    fileId: seed.fileId,
    parents: seed.parents ?? [],
    path: seed.path,
    deleted: seed.deleted ?? false,
    content: seed.content ?? (await content(`# ${seed.path}\n`)),
    clientTime: seed.clientTime ?? '2026-09-06T10:00:00.000Z',
    message: seed.message ?? null,
    restoredFrom: seed.restoredFrom ?? null,
  };
}

/** One changeset with test defaults. */
function changeset(
  revisions: readonly RevisionInput[],
  overrides: Partial<ChangesetInput> = {},
): ChangesetInput {
  return {
    workspaceId,
    mutationId: overrides.mutationId ?? id('m'),
    deviceId: overrides.deviceId ?? 'device-1',
    expectedHeads:
      overrides.expectedHeads ??
      Object.fromEntries(revisions.map((entry) => [entry.fileId, null])),
    revisions,
  };
}

/** The accepted outcome, or a clear failure. */
function accepted(result: Result<AcceptedChangeset>): AcceptedChangeset {
  if (!result.ok)
    assert.fail(`the changeset was rejected: ${result.error.code}`);
  return result.value;
}

/** The domain failure, or a clear failure. */
function rejected(result: Result<AcceptedChangeset>): {
  code: string;
  fileIds: readonly string[];
} {
  if (result.ok) assert.fail('the changeset was accepted');
  return result.error;
}

await test('an editor creates a file and the head advances', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const first = await revision({ fileId: id('f'), path: 'notes/one.md' });
  const outcome = accepted(
    await commitChangeset(store, actor, changeset([first]), 'digest-1'),
  );
  assert.deepEqual(outcome.revisionIds, [first.id]);
  assert.equal(state.files.get(first.fileId)?.headRevisionId, first.id);
  assert.equal(state.deletions.length, 0);
});

await test('a replay with the same digest returns the stored outcome after the head moved', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  const first = await revision({ fileId, path: 'notes/one.md' });
  const input = changeset([first]);
  const outcome = accepted(
    await commitChangeset(store, actor, input, 'digest-1'),
  );

  // Another device advances the head before the retry arrives.
  const second = await revision({
    fileId,
    path: 'notes/one.md',
    parents: [first.id],
  });
  accepted(
    await commitChangeset(
      store,
      actor,
      changeset([second], { expectedHeads: { [fileId]: first.id } }),
      'digest-2',
    ),
  );

  const replay = accepted(
    await commitChangeset(store, actor, input, 'digest-1'),
  );
  assert.deepEqual(replay, outcome);
  // The replay wrote nothing: the head still names the newer revision.
  assert.equal(state.files.get(fileId)?.headRevisionId, second.id);
  assert.equal(state.accepted.length, 2);
});

await test('the same mutation identity with another body is refused', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  const input = changeset([await revision({ fileId, path: 'notes/one.md' })]);
  accepted(await commitChangeset(store, actor, input, 'digest-1'));
  const changed = {
    ...input,
    revisions: [await revision({ fileId, path: 'notes/other.md' })],
  };
  const failure = rejected(
    await commitChangeset(store, actor, changed, 'digest-other'),
  );
  assert.equal(failure.code, 'mutation_reused');
  assert.deepEqual(failure.fileIds, [fileId]);
  assert.equal(state.accepted.length, 1);
});

await test('a stale expected head names the files that changed', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  const first = await revision({ fileId, path: 'notes/one.md' });
  accepted(await commitChangeset(store, actor, changeset([first]), 'd-1'));
  const stale = await revision({
    fileId,
    path: 'notes/one.md',
    parents: [first.id],
  });
  const failure = rejected(
    await commitChangeset(
      store,
      actor,
      changeset([stale], { expectedHeads: { [fileId]: id('r') } }),
      'd-2',
    ),
  );
  assert.equal(failure.code, 'stale_head');
  assert.deepEqual(failure.fileIds, [fileId]);
});

await test('a changeset without a precondition for a changed file is refused', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const first = await revision({ fileId: id('f'), path: 'notes/one.md' });
  const failure = rejected(
    await commitChangeset(
      store,
      actor,
      changeset([first], { expectedHeads: {} }),
      'd-1',
    ),
  );
  assert.equal(failure.code, 'invalid_graph');
  assert.deepEqual(failure.fileIds, [first.fileId]);
});

await test('a precondition for a file that the changeset does not change is refused', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const first = await revision({ fileId: id('f'), path: 'notes/one.md' });
  const other = id('f');
  const failure = rejected(
    await commitChangeset(
      store,
      actor,
      changeset([first], {
        expectedHeads: { [first.fileId]: null, [other]: null },
      }),
      'd-1',
    ),
  );
  assert.equal(failure.code, 'invalid_graph');
  assert.deepEqual(failure.fileIds, [other]);
});

await test('a purged file identifier can never be written again', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  state.purged.add(fileId);
  const failure = rejected(
    await commitChangeset(
      store,
      actor,
      changeset([await revision({ fileId, path: 'notes/gone.md' })]),
      'd-1',
    ),
  );
  assert.equal(failure.code, 'purged');
  assert.deepEqual(failure.fileIds, [fileId]);
  assert.equal(state.accepted.length, 0);
});

await test('an account without a membership is refused', async () => {
  const state = new FakeWorkspace();
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const failure = rejected(
    await commitChangeset(
      store,
      actor,
      changeset([await revision({ fileId: id('f'), path: 'notes/one.md' })]),
      'd-1',
    ),
  );
  assert.equal(failure.code, 'forbidden');
  assert.deepEqual(failure.fileIds, []);
});

await test('a viewer cannot write, and a write grant cannot widen the role', async () => {
  const viewer = workspaceWith('viewer');
  const denied = rejected(
    await commitChangeset(
      fakeStore(viewer),
      actorWith(['read', 'write']),
      changeset([await revision({ fileId: id('f'), path: 'notes/one.md' })]),
      'd-1',
    ),
  );
  assert.equal(denied.code, 'forbidden');
  assert.equal(viewer.accepted.length, 0);

  // The other direction: the role permits the write, but the token does not.
  const editor = workspaceWith('editor');
  const narrow = rejected(
    await commitChangeset(
      fakeStore(editor),
      actorWith(['read']),
      changeset([await revision({ fileId: id('f'), path: 'notes/one.md' })]),
      'd-1',
    ),
  );
  assert.equal(narrow.code, 'forbidden');
  assert.equal(editor.accepted.length, 0);
});

await test('content that does not match its digest is refused', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  const forged = await revision({
    fileId,
    path: 'notes/one.md',
    content: {
      kind: 'markdown',
      digest: await contentDigest('# other\n'),
      text: '# one\n',
    },
  });
  const failure = rejected(
    await commitChangeset(store, actor, changeset([forged]), 'd-1'),
  );
  assert.equal(failure.code, 'invalid_content');
  assert.deepEqual(failure.fileIds, [fileId]);
  assert.equal(state.accepted.length, 0);
});

await test('markdown that is not well formed is refused', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  // A lone surrogate becomes U+FFFD in UTF-8, so the stored bytes would differ
  // from the submitted string and the digest could never match again.
  const broken = '# \ud800\n';
  const fileId = id('f');
  const failure = rejected(
    await commitChangeset(
      store,
      actor,
      changeset([
        await revision({
          fileId,
          path: 'notes/broken.md',
          content: {
            kind: 'markdown',
            digest: await contentDigest(broken),
            text: broken,
          },
        }),
      ]),
      'd-1',
    ),
  );
  assert.equal(failure.code, 'invalid_content');
  assert.deepEqual(failure.fileIds, [fileId]);
  assert.equal(state.accepted.length, 0);
});

await test('a tombstone that carries markdown is refused', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  const first = await revision({ fileId, path: 'notes/one.md' });
  accepted(await commitChangeset(store, actor, changeset([first]), 'd-1'));
  // A deletion that carried content would add bytes while it claims to remove
  // a file, and the quota reserve exists for operations that add nothing.
  const failure = rejected(
    await commitChangeset(
      store,
      actor,
      changeset(
        [
          await revision({
            fileId,
            path: 'notes/one.md',
            parents: [first.id],
            deleted: true,
            content: await content('# still here\n'),
          }),
        ],
        { expectedHeads: { [fileId]: first.id } },
      ),
      'd-2',
    ),
  );
  assert.equal(failure.code, 'invalid_content');
  assert.deepEqual(failure.fileIds, [fileId]);
  assert.equal(state.files.get(fileId)?.deleted, false);
});

await test('a path outside the rules is refused before any write', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  for (const path of ['../escape.md', 'notes/one.txt', '/notes/one.md']) {
    const failure = rejected(
      await commitChangeset(
        store,
        actor,
        changeset([await revision({ fileId: id('f'), path })]),
        'd-1',
      ),
    );
    assert.equal(failure.code, 'invalid_path', path);
  }
  assert.equal(state.accepted.length, 0);
});

await test('an accepted path is stored in its normalized form', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  accepted(
    await commitChangeset(
      store,
      actor,
      changeset([await revision({ fileId, path: 'notes/cafe\u0301.md' })]),
      'd-1',
    ),
  );
  assert.equal(state.files.get(fileId)?.path, 'notes/caf\u00e9.md');
});

await test('a rename and a content change travel in one revision', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  const first = await revision({ fileId, path: 'notes/one.md' });
  accepted(await commitChangeset(store, actor, changeset([first]), 'd-1'));
  const moved = await revision({
    fileId,
    path: 'archive/one.md',
    parents: [first.id],
    content: await content('# moved and edited\n'),
  });
  accepted(
    await commitChangeset(
      store,
      actor,
      changeset([moved], { expectedHeads: { [fileId]: first.id } }),
      'd-2',
    ),
  );
  const file = state.files.get(fileId);
  assert.equal(file?.path, 'archive/one.md');
  assert.equal(state.revisions.get(moved.id)?.text, '# moved and edited\n');
});

await test('two files swap their paths in one changeset', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const left = id('f');
  const right = id('f');
  const first = await revision({ fileId: left, path: 'a.md' });
  const second = await revision({ fileId: right, path: 'b.md' });
  accepted(
    await commitChangeset(store, actor, changeset([first, second]), 'd-1'),
  );
  const swapped = accepted(
    await commitChangeset(
      store,
      actor,
      changeset(
        [
          await revision({ fileId: left, path: 'b.md', parents: [first.id] }),
          await revision({ fileId: right, path: 'a.md', parents: [second.id] }),
        ],
        { expectedHeads: { [left]: first.id, [right]: second.id } },
      ),
      'd-2',
    ),
  );
  assert.equal(swapped.revisionIds.length, 2);
  assert.equal(state.files.get(left)?.path, 'b.md');
  assert.equal(state.files.get(right)?.path, 'a.md');
});

await test('a tombstone deletes the file and removes its side records', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  const first = await revision({ fileId, path: 'notes/one.md' });
  accepted(await commitChangeset(store, actor, changeset([first]), 'd-1'));
  accepted(
    await commitChangeset(
      store,
      actor,
      changeset(
        [
          await revision({
            fileId,
            path: 'notes/one.md',
            parents: [first.id],
            deleted: true,
            content: await content(''),
          }),
        ],
        { expectedHeads: { [fileId]: first.id } },
      ),
      'd-2',
    ),
  );
  assert.equal(state.files.get(fileId)?.deleted, true);
  assert.deepEqual(state.deletions, [[fileId]]);
});

await test('side records are removed only when the write succeeded', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  state.refuse = fail<AcceptedChangeset>('path_conflict', ['x']);
  const failure = rejected(
    await commitChangeset(
      store,
      actor,
      changeset([
        await revision({
          fileId: id('f'),
          path: 'notes/one.md',
          deleted: true,
          content: await content(''),
        }),
      ]),
      'd-1',
    ),
  );
  assert.equal(failure.code, 'path_conflict');
  assert.deepEqual(state.deletions, []);
});

await test('a changeset over the file limit is refused before any query', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const revisions: RevisionInput[] = [];
  for (let index = 0; index <= maxFilesPerChangeset; index += 1) {
    revisions.push(
      await revision({ fileId: id('f'), path: `notes/${String(index)}.md` }),
    );
  }
  const failure = rejected(
    await commitChangeset(store, actor, changeset(revisions), 'd-1'),
  );
  assert.equal(failure.code, 'invalid_graph');
  assert.equal(failure.fileIds.length, maxFilesPerChangeset + 1);
  assert.equal(state.accepted.length, 0);
  // The same submission without the last file is accepted.
  const fitting = revisions.slice(0, maxFilesPerChangeset);
  accepted(await commitChangeset(store, actor, changeset(fitting), 'd-2'));
  assert.equal(state.accepted.length, 1);
});

await test('an empty changeset is refused', async () => {
  const state = workspaceWith('editor');
  const failure = rejected(
    await commitChangeset(
      fakeStore(state),
      actorWith(['read', 'write']),
      changeset([]),
      'd-1',
    ),
  );
  assert.equal(failure.code, 'invalid_graph');
});

await test('a second root for an existing file is refused', async () => {
  const state = workspaceWith('editor');
  const store = fakeStore(state);
  const actor = actorWith(['read', 'write']);
  const fileId = id('f');
  const first = await revision({ fileId, path: 'notes/one.md' });
  accepted(await commitChangeset(store, actor, changeset([first]), 'd-1'));
  // A root revision names no parent, and the expected head is the stored one.
  const failure = rejected(
    await commitChangeset(
      store,
      actor,
      changeset([await revision({ fileId, path: 'notes/one.md' })], {
        expectedHeads: { [fileId]: first.id },
      }),
      'd-2',
    ),
  );
  assert.equal(failure.code, 'invalid_graph');
});
