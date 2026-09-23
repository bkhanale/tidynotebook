/** Portable path indexing, move rewrites, and legacy data migration. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { commitChangeset, listBacklinks, readFile } from '@notesapp/core';
import { readDocumentText } from '@notesapp/note-document';
import {
  createDocumentService,
  migrateNoteDocuments,
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
    text:
      target.content.kind === 'markdown' &&
      target.content.document.work.kind === 'text'
        ? target.content.document.work.text
        : '',
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

  const result = await migratePortableMarkdown(
    database.migrationUrl,
    createDocumentService(),
  );
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

await test('the data migration starts the document of every note that has none', async () => {
  const workspaceId = randomUUID();
  const accountId = randomUUID();
  await seedWorkspace(database, workspaceId, [{ accountId, role: 'owner' }]);
  const actor = memberActor(accountId, workspaceId);
  const live = revision({
    fileId: randomUUID(),
    path: 'live.md',
    text: '# Live\r\n\nText with é and 🙂.\n',
  });
  const trashed = revision({
    fileId: randomUUID(),
    path: 'trashed.md',
    text: '# Kept for Restore\n',
  });
  const seeded = await commitChangeset(
    store,
    actor,
    changeset(workspaceId, [live, trashed]),
    'documents-seed',
  );
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  const tombstone = revision({
    fileId: trashed.fileId,
    parents: [trashed.id],
    path: trashed.path,
    deleted: true,
    text: '',
  });
  const removed = await commitChangeset(
    store,
    actor,
    changeset(workspaceId, [tombstone], {
      expectedHeads: { [trashed.fileId]: trashed.id },
    }),
    'documents-trash',
  );
  assert.equal(removed.ok, true, JSON.stringify(removed));

  // An earlier release wrote these notes, so neither holds a document.
  const session = await openSession(database.migrationUrl);
  try {
    await session.query('delete from note_documents where workspace_id = $1', [
      workspaceId,
    ]);
    const first = await migrateNoteDocuments(
      database.migrationUrl,
      createDocumentService(),
    );
    assert.equal(first.startedNotes, 2);
    const rows = await session.query<{
      file_id: string;
      epoch: number;
      bytes: Buffer;
    }>(
      `select file_id, epoch, bytes from note_documents
       where workspace_id = $1`,
      [workspaceId],
    );
    const texts = new Map(
      rows.map((row) => [
        row.file_id,
        readDocumentText(new Uint8Array(row.bytes)),
      ]),
    );
    // A live note starts from its head, with every line ending and every
    // character as stored. A note in Trash starts from the text that Restore
    // brings back, not from its empty tombstone (record 0084).
    assert.equal(texts.get(live.fileId), '# Live\r\n\nText with é and 🙂.\n');
    assert.equal(texts.get(trashed.fileId), '# Kept for Restore\n');
    assert.deepEqual(
      rows.map((row) => row.epoch),
      [1, 1],
    );
    // A second run finds every note started and writes nothing.
    const second = await migrateNoteDocuments(
      database.migrationUrl,
      createDocumentService(),
    );
    assert.equal(second.startedNotes, 0);
  } finally {
    await session.close();
  }
});

await store.close();
await database.destroy();
