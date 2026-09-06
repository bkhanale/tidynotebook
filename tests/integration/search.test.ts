/** Search, stable links, backlinks, and local draft search checks. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  commitChangeset,
  getBacklinks,
  searchFiles,
  verifyActor,
  tombstoneContent,
  type RevisionInput,
} from '@notesapp/core';
import { openLocalStore } from '@notesapp/storage-browser';
import { openWorkspaceStore } from '@notesapp/storage-server';
import { searchLocal } from '@notesapp/sync';
import {
  changeset,
  memberActor,
  revision,
  seedWorkspace,
  createDisposableDatabase,
} from './support/database.ts';

const database = await createDisposableDatabase();
const store = openWorkspaceStore(database.runtimeUrl);
const accountId = randomUUID();
const workspaceId = randomUUID();
await seedWorkspace(database, workspaceId, [{ accountId, role: 'owner' }]);
const actor = memberActor(accountId, workspaceId);

/** Accepts one or more revisions and returns their last revision. */
async function accept(
  entries: readonly RevisionInput[],
  expectedHeads?: Readonly<Record<string, string | null>>,
): Promise<RevisionInput> {
  const input = changeset(workspaceId, entries, {
    ...(expectedHeads === undefined ? {} : { expectedHeads }),
  });
  const accepted = await commitChangeset(
    store,
    actor,
    input,
    `search-${input.mutationId}`,
  );
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const last = entries.at(-1);
  assert.ok(last !== undefined);
  return last;
}

await test('search includes accepted titles and content but not deleted notes', async () => {
  const fileId = randomUUID();
  const first = await accept([
    revision({
      fileId,
      path: 'plans/offline.md',
      text: '# Recovery\nThe durable queue keeps offline work safe.\n',
    }),
  ]);
  const found = await searchFiles(store, actor, workspaceId, 'durable offline');
  assert.equal(found.ok, true);
  if (found.ok) {
    assert.deepEqual(
      found.value.map((hit) => hit.fileId),
      [fileId],
    );
    assert.equal(found.value[0]?.revisionId, first.id);
  }

  await accept(
    [
      revision({
        fileId,
        parents: [first.id],
        path: first.path,
        deleted: true,
        content: await tombstoneContent(first.content),
      }),
    ],
    { [fileId]: first.id },
  );
  const afterDelete = await searchFiles(store, actor, workspaceId, 'durable');
  assert.equal(afterDelete.ok, true);
  if (afterDelete.ok) assert.deepEqual(afterDelete.value, []);
});

await test('a direct stable link survives target rename and gives one backlink', async () => {
  const targetId = randomUUID();
  const target = await accept([
    revision({ fileId: targetId, path: 'Topic.md', text: '# Topic\n' }),
  ]);
  const sourceId = randomUUID();
  const source = await accept([
    revision({
      fileId: sourceId,
      path: 'source.md',
      text: `[Topic](/notes/${targetId})`,
    }),
  ]);
  const before = await getBacklinks(store, actor, workspaceId, targetId);
  assert.equal(before.ok, true);
  if (before.ok) assert.equal(before.value[0]?.revisionId, source.id);

  await accept(
    [
      revision({
        fileId: targetId,
        parents: [target.id],
        path: 'renamed/Topic.md',
        content: target.content,
      }),
    ],
    { [targetId]: target.id },
  );
  const after = await getBacklinks(store, actor, workspaceId, targetId);
  assert.equal(after.ok, true);
  if (after.ok)
    assert.deepEqual(
      after.value.map((hit) => hit.fileId),
      [sourceId],
    );
});

await test('an ambiguous wiki title is left unresolved', async () => {
  const firstId = randomUUID();
  const secondId = randomUUID();
  await accept([
    revision({ fileId: firstId, path: 'a/Duplicate.md' }),
    revision({ fileId: secondId, path: 'b/Duplicate.md' }),
  ]);
  await accept([
    revision({
      fileId: randomUUID(),
      path: 'ambiguous-source.md',
      text: '[[Duplicate]]',
    }),
  ]);
  const first = await getBacklinks(store, actor, workspaceId, firstId);
  const second = await getBacklinks(store, actor, workspaceId, secondId);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok) assert.deepEqual(first.value, []);
  if (second.ok) assert.deepEqual(second.value, []);
});

await test('search requires the current role and a read grant', async () => {
  const created = verifyActor(accountId, [{ workspaceId, actions: ['write'] }]);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const denied = await searchFiles(
    store,
    created.value,
    workspaceId,
    'Duplicate',
  );
  assert.deepEqual(denied, {
    ok: false,
    error: { code: 'forbidden', fileIds: [] },
  });
});

await test('local draft search stays inside its account and workspace', async () => {
  const local = await openLocalStore('https://local-search.test', {
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    databaseName: `notesapp-search-${randomUUID()}`,
    deviceId: 'search-device',
  });
  const otherAccount = randomUUID();
  await local.saveDraft({
    accountId,
    workspaceId,
    workingCopyId: randomUUID(),
    fileId: randomUUID(),
    baseRevisionId: null,
    text: 'pending draft needle',
    path: 'draft.md',
    deleted: false,
    sequence: 1,
  });
  await local.saveDraft({
    accountId: otherAccount,
    workspaceId,
    workingCopyId: randomUUID(),
    fileId: randomUUID(),
    baseRevisionId: null,
    text: 'private needle',
    path: 'private.md',
    deleted: false,
    sequence: 1,
  });
  const documents = await local.listSearchFiles(accountId, workspaceId);
  assert.deepEqual(
    searchLocal('needle', documents).map((hit) => hit.path),
    ['draft.md'],
  );
  await local.close();
});

await store.close();
await database.destroy();
