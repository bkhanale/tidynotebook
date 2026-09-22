/** Portable path indexing, move rewrites, and legacy data migration. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { commitChangeset, listBacklinks, readFile } from '@notesapp/core';
import {
  createDocumentService,
  migratePortableMarkdown,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import {
  changeset,
  createDisposableDatabase,
  memberActor,
  openSession,
  revision,
  seedWorkspace,
} from './support/database.ts';

const database = await createDisposableDatabase();
const store = openWorkspaceStore(database.runtimeUrl, createDocumentService());

await test('a move rewrites inbound links in its accepted changeset', async () => {
  const workspaceId = randomUUID();
  const accountId = randomUUID();
  await seedWorkspace(database, workspaceId, [{ accountId, role: 'owner' }]);
  const actor = memberActor(accountId, workspaceId);
  const target = revision({ fileId: randomUUID(), path: 'folder/a.md' });
  const source = revision({
    fileId: randomUUID(),
    path: 'folder/source.md',
    text: '[A](a.md)\n',
  });
  const changedSource = revision({
    fileId: randomUUID(),
    path: 'folder/changed.md',
    text: '# No link\n',
  });
  const seeded = changeset(workspaceId, [target, source, changedSource]);
  const first = await commitChangeset(store, actor, seeded, 'portable-seed');
  assert.equal(first.ok, true, JSON.stringify(first));

  const before = await listBacklinks(store, actor, workspaceId, target.fileId);
  assert.equal(before.ok, true);
  if (before.ok) assert.equal(before.value[0]?.fileId, source.fileId);

  const moved = revision({
    fileId: target.fileId,
    parents: [target.id],
    path: 'archive/a.md',
    text: target.content.kind === 'markdown' ? target.content.text : '',
  });
  const changedWithLink = revision({
    fileId: changedSource.fileId,
    parents: [changedSource.id],
    path: changedSource.path,
    text: '[New link](a.md)\n',
  });
  const input = changeset(workspaceId, [moved, changedWithLink], {
    expectedHeads: {
      [target.fileId]: target.id,
      [changedSource.fileId]: changedSource.id,
    },
  });
  const accepted = await commitChangeset(store, actor, input, 'portable-move');
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  if (accepted.ok) assert.equal(accepted.value.revisionIds.length, 3);

  const linked = await readFile(store, actor, workspaceId, source.fileId);
  assert.equal(linked.ok, true);
  if (linked.ok)
    assert.equal(linked.value.head?.text, '[A](../archive/a.md)\n');
  const changed = await readFile(
    store,
    actor,
    workspaceId,
    changedSource.fileId,
  );
  assert.equal(changed.ok, true);
  if (changed.ok)
    assert.equal(changed.value.head?.text, '[New link](../archive/a.md)\n');
  const after = await listBacklinks(store, actor, workspaceId, target.fileId);
  assert.equal(after.ok, true);
  if (after.ok)
    assert.deepEqual(
      new Set(after.value.map((item) => item.fileId)),
      new Set([source.fileId, changedSource.fileId]),
    );
});

await test('the data migration rewrites live legacy links and reports dead links', async () => {
  const workspaceId = randomUUID();
  const accountId = randomUUID();
  await seedWorkspace(database, workspaceId, [{ accountId, role: 'owner' }]);
  const actor = memberActor(accountId, workspaceId);
  const target = revision({ fileId: randomUUID(), path: 'plan.md' });
  const deadId = randomUUID();
  const source = revision({
    fileId: randomUUID(),
    path: 'folder/legacy.md',
    text: `[plan](/notes/${target.fileId}) [dead](/notes/${deadId})\n`,
  });
  const input = changeset(workspaceId, [target, source]);
  const seeded = await commitChangeset(store, actor, input, 'legacy-seed');
  assert.equal(seeded.ok, true, JSON.stringify(seeded));

  const result = await migratePortableMarkdown(database.migrationUrl);
  assert.equal(result.revisedNotes, 1);
  assert.equal(result.deadReferences, 1);
  const migrated = await readFile(store, actor, workspaceId, source.fileId);
  assert.equal(migrated.ok, true);
  if (migrated.ok)
    assert.equal(
      migrated.value.head?.text,
      `[plan](../plan.md) [dead](/notes/${deadId})\n`,
    );
  const session = await openSession(database.migrationUrl);
  try {
    const rows = await session.query<{ reference: string }>(
      `select reference from portable_markdown_migration_report
       where workspace_id = $1`,
      [workspaceId],
    );
    assert.deepEqual(
      rows.map((row) => row.reference),
      [`/notes/${deadId}`],
    );
  } finally {
    await session.close();
  }
});

await store.close();
await database.destroy();
