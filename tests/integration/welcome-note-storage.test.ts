/** Welcome note completion shares the content transaction and owner scope. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  completeWelcomeNote,
  createFileChangeset,
  workspaceText,
} from '@notesapp/core';
import {
  createDocumentService,
  openWorkspaceStore,
} from '@notesapp/storage-server';
import {
  createDisposableDatabase,
  memberActor,
  openSession,
  seedWorkspace,
} from './support/database.ts';

await test('a failed completion rolls back the note and keeps pending work in the owner scope', async () => {
  const database = await createDisposableDatabase();
  const content = openWorkspaceStore(
    database.runtimeUrl,
    createDocumentService(),
  );
  const session = await openSession(database.migrationUrl);
  const accountId = randomUUID();
  const workspaceId = randomUUID();
  const strangerId = randomUUID();
  const strangerWorkspace = randomUUID();
  try {
    await seedWorkspace(database, workspaceId, [{ accountId, role: 'owner' }]);
    await seedWorkspace(database, strangerWorkspace, [
      { accountId: strangerId, role: 'owner' },
    ]);
    await session.query('update workspaces set personal = true where id = $1', [
      workspaceId,
    ]);
    await session.query(
      'insert into workspace_welcome_notes(workspace_id) values ($1)',
      [workspaceId],
    );
    await session.query(`create function test_refuse_welcome() returns trigger language plpgsql as $$
      begin raise exception 'private database and note details'; end $$`);
    await session.query(`create trigger test_refuse_welcome before update on workspace_welcome_notes
      for each row when (NEW.completed_at is not null) execute function test_refuse_welcome()`);
    const input = createFileChangeset({
      workspaceId,
      fileId: randomUUID(),
      revisionId: randomUUID(),
      path: 'Welcome to tidy notebook.md',
      content: workspaceText('Test note.', 1),
      message: null,
      ids: {
        mutationId: randomUUID(),
        deviceId: randomUUID(),
        clientTime: new Date().toISOString(),
      },
    });
    const actor = memberActor(accountId, workspaceId);
    await assert.rejects(() =>
      completeWelcomeNote(content, actor, input, 'welcome-storage-test'),
    );
    const [failed] = await session.query<{
      count: string;
      completed_at: Date | null;
      failure_code: string | null;
    }>(
      `select (select count(*) from files where workspace_id = $1) as count,
       completed_at, failure_code from workspace_welcome_notes where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(
      Number(failed?.count),
      0,
      'the note did not escape the failed completion transaction',
    );
    assert.equal(failed?.completed_at, null);
    assert.equal(failed?.failure_code, 'unexpected');
    await session.query(
      'drop trigger test_refuse_welcome on workspace_welcome_notes',
    );
    assert.deepEqual(
      await completeWelcomeNote(content, actor, input, 'welcome-storage-test'),
      { ok: true, value: 'created' },
    );
    const [completed] = await session.query<{
      count: string;
      completed: boolean;
    }>(
      `select (select count(*) from files where workspace_id = $1) as count,
       completed_at is not null as completed from workspace_welcome_notes where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(Number(completed?.count), 1);
    assert.equal(completed?.completed, true);

    const stranger = await openSession(database.runtimeUrl, strangerId);
    try {
      assert.equal(
        (
          await stranger.query(
            'select * from workspace_welcome_notes where workspace_id = $1',
            [workspaceId],
          )
        ).length,
        0,
      );
      const changed = await stranger.query(
        'update workspace_welcome_notes set completed_at = null where workspace_id = $1 returning workspace_id',
        [workspaceId],
      );
      assert.equal(changed.length, 0);
    } finally {
      await stranger.close();
    }
    await session.query(
      "update accounts set standing = 'locked' where id = $1",
      [accountId],
    );
    const owner = await openSession(database.runtimeUrl, accountId);
    try {
      const refused = await owner.failure(
        'update workspace_welcome_notes set completed_at = null where workspace_id = $1',
        [workspaceId],
      );
      assert.equal(refused.code, 'NA004');
    } finally {
      await owner.close();
    }
  } finally {
    await session.close();
    await content.close();
    await database.destroy();
  }
});
