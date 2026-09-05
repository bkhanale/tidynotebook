/**
 * Workspace storage against a real PostgreSQL service.
 *
 * Every check below runs with the runtime role, which cannot migrate and
 * cannot bypass row security. Start the service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { inspect } from 'node:util';
import type { AcceptedChangeset, Result } from '@notesapp/core';
import { isOperationalError } from '@notesapp/core';
import {
  openWorkspaceStore,
  runMigrations,
  runtimeRole,
  withCredentials,
  WorkspaceUnavailableError,
  type WorkspaceStoreHandle,
} from '@notesapp/storage-server';
import {
  changeset,
  createDisposableDatabase,
  markdown,
  markdownDigest,
  memberActor,
  openSession,
  revision,
  seedWorkspace,
  testActor,
  type TestDatabase,
} from './support/database.ts';

const database: TestDatabase = await createDisposableDatabase();
const store: WorkspaceStoreHandle = openWorkspaceStore(database.runtimeUrl, {
  poolSize: 6,
});

/** Creates one workspace with one owner and returns its identifiers. */
async function newWorkspace(
  quotaBytes?: bigint,
): Promise<{ workspaceId: string; accountId: string }> {
  const workspaceId = randomUUID();
  const accountId = randomUUID();
  await seedWorkspace(
    database,
    workspaceId,
    [{ accountId, role: 'owner' }],
    quotaBytes,
  );
  return { workspaceId, accountId };
}

/** Fails the test when a changeset was not accepted. */
function accepted(result: Result<AcceptedChangeset>): AcceptedChangeset {
  if (!result.ok) {
    assert.fail(`the changeset was rejected with ${result.error.code}`);
  }
  return result.value;
}

/** The value that a failing call threw, or a clear test failure. */
async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  assert.fail('the call was expected to fail');
}

/** Counts rows of one table inside one workspace. */
async function countRows(table: string, workspaceId: string): Promise<number> {
  const session = await openSession(database.migrationUrl);
  try {
    const rows = await session.query<{ total: number }>(
      `select count(*)::int as total from ${table} where workspace_id = $1`,
      [workspaceId],
    );
    return rows[0]?.total ?? -1;
  } finally {
    await session.close();
  }
}

await test('accepted changesets: writes a two file changeset and reports both heads', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const first = revision({ fileId: randomUUID(), path: 'notes/one.md' });
  const second = revision({ fileId: randomUUID(), path: 'notes/two.md' });
  const input = changeset(workspaceId, [first, second]);

  const outcome = accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, input, 'digest-two-files'),
    ),
  );

  assert.equal(outcome.mutationId, input.mutationId);
  assert.deepEqual(
    [...outcome.revisionIds].sort(),
    [first.id, second.id].sort(),
  );
  assert.equal(outcome.cursor, '1');

  const heads = await store.transact(actor, workspaceId, (tx) =>
    tx.heads([first.fileId, second.fileId]),
  );
  assert.equal(heads.get(first.fileId), first.id);
  assert.equal(heads.get(second.fileId), second.id);
  assert.equal(await countRows('revisions', workspaceId), 2);
  assert.equal(await countRows('sync_changes', workspaceId), 2);
});

await test('accepted changesets: stores equal content once inside one workspace', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const shared = markdown('# shared body\n');
  const input = changeset(workspaceId, [
    revision({
      fileId: randomUUID(),
      path: 'notes/copy-a.md',
      content: shared,
    }),
    revision({
      fileId: randomUUID(),
      path: 'notes/copy-b.md',
      content: shared,
    }),
  ]);

  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, input, 'digest-duplicate'),
    ),
  );

  assert.equal(await countRows('contents', workspaceId), 1);
  assert.equal(await countRows('revisions', workspaceId), 2);
});

await test('accepted changesets: records the accepted path of every live file', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const only = revision({ fileId: randomUUID(), path: 'notes/live.md' });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, changeset(workspaceId, [only]), 'digest-live'),
    ),
  );
  assert.equal(await countRows('live_paths', workspaceId), 1);

  const removal = revision({
    fileId: only.fileId,
    parents: [only.id],
    path: 'notes/live.md',
    deleted: true,
    text: '# notes/live.md\n',
  });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, changeset(workspaceId, [removal]), 'digest-removed'),
    ),
  );
  assert.equal(await countRows('live_paths', workspaceId), 0);
});

await test('accepted changesets: rejects a second live file on one accepted path', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(
        actor,
        changeset(workspaceId, [
          revision({ fileId: randomUUID(), path: 'notes/taken.md' }),
        ]),
        'digest-taken',
      ),
    ),
  );

  const clash = revision({ fileId: randomUUID(), path: 'notes/taken.md' });
  const result = await store.transact(actor, workspaceId, (tx) =>
    tx.accept(actor, changeset(workspaceId, [clash]), 'digest-clash'),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'path_conflict');
    assert.deepEqual(result.error.fileIds, [clash.fileId]);
  }
  assert.equal(await countRows('live_paths', workspaceId), 1);
});

await test('accepted changesets: swaps two accepted paths inside one changeset', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const left = revision({ fileId: randomUUID(), path: 'notes/left.md' });
  const right = revision({ fileId: randomUUID(), path: 'notes/right.md' });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(
        actor,
        changeset(workspaceId, [left, right]),
        'digest-before-swap',
      ),
    ),
  );

  const swap = changeset(workspaceId, [
    revision({
      fileId: left.fileId,
      parents: [left.id],
      path: 'notes/right.md',
      text: '# left moved\n',
    }),
    revision({
      fileId: right.fileId,
      parents: [right.id],
      path: 'notes/left.md',
      text: '# right moved\n',
    }),
  ]);
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, swap, 'digest-swap'),
    ),
  );

  const session = await openSession(database.migrationUrl);
  try {
    const rows = await session.query<{ file_id: string; path: string }>(
      'select file_id, path from live_paths where workspace_id = $1 order by path',
      [workspaceId],
    );
    assert.deepEqual(
      rows.map((row) => row.path),
      ['notes/left.md', 'notes/right.md'],
    );
    assert.equal(rows[0]?.file_id, right.fileId);
    assert.equal(rows[1]?.file_id, left.fileId);
  } finally {
    await session.close();
  }
});

await test('workspace boundaries: rejects a parent revision of another workspace', async () => {
  const source = await newWorkspace();
  const target = await newWorkspace();
  const sourceActor = memberActor(source.accountId, source.workspaceId);
  const seed = revision({ fileId: randomUUID(), path: 'notes/source.md' });
  accepted(
    await store.transact(sourceActor, source.workspaceId, (tx) =>
      tx.accept(
        sourceActor,
        changeset(source.workspaceId, [seed]),
        'digest-source',
      ),
    ),
  );

  const targetActor = memberActor(target.accountId, target.workspaceId);
  const borrowed = revision({
    fileId: randomUUID(),
    parents: [seed.id],
    path: 'notes/borrowed.md',
  });
  const result = await store.transact(targetActor, target.workspaceId, (tx) =>
    tx.accept(
      targetActor,
      changeset(target.workspaceId, [borrowed]),
      'digest-borrowed',
    ),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'invalid_graph');
  assert.equal(await countRows('revisions', target.workspaceId), 0);
});

await test('workspace boundaries: rejects a cross workspace revision through the composite foreign key', async () => {
  const source = await newWorkspace();
  const target = await newWorkspace();
  const actor = memberActor(source.accountId, source.workspaceId);
  const seed = revision({ fileId: randomUUID(), path: 'notes/fk.md' });
  accepted(
    await store.transact(actor, source.workspaceId, (tx) =>
      tx.accept(actor, changeset(source.workspaceId, [seed]), 'digest-fk'),
    ),
  );

  const session = await openSession(database.migrationUrl);
  try {
    const failure = await session.failure(
      `insert into revision_parents (workspace_id, child_id, parent_id, ordinal)
       values ($1, $2, $3, 0)`,
      [target.workspaceId, randomUUID(), seed.id],
    );
    assert.equal(failure.code, '23503');
    assert.match(failure.message, /revision_parents_(child|parent)_fk/);
  } finally {
    await session.close();
  }
});

await test('workspace boundaries: leaves no partial result when one file of a changeset fails', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const good = revision({ fileId: randomUUID(), path: 'notes/good.md' });
  const bad = revision({
    fileId: randomUUID(),
    parents: [randomUUID()],
    path: 'notes/bad.md',
  });

  const result = await store.transact(actor, workspaceId, (tx) =>
    tx.accept(actor, changeset(workspaceId, [good, bad]), 'digest-partial'),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'invalid_graph');
  assert.equal(await countRows('revisions', workspaceId), 0);
  assert.equal(await countRows('contents', workspaceId), 0);
  assert.equal(await countRows('changesets', workspaceId), 0);
  assert.equal(await countRows('live_paths', workspaceId), 0);
  const heads = await store.transact(actor, workspaceId, (tx) =>
    tx.heads([good.fileId, bad.fileId]),
  );
  assert.equal(heads.get(good.fileId), null);
  assert.equal(heads.get(bad.fileId), null);
});

await test('commit order: allocates strictly increasing cursors without a gap', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const inputs = Array.from({ length: 4 }, (_, index) =>
    changeset(workspaceId, [
      revision({ fileId: randomUUID(), path: `notes/parallel-${index}.md` }),
    ]),
  );

  const outcomes = await Promise.all(
    inputs.map((input, index) =>
      store.transact(actor, workspaceId, (tx) =>
        tx.accept(actor, input, `digest-parallel-${index}`),
      ),
    ),
  );

  const cursors = outcomes
    .map((outcome) => Number(accepted(outcome).cursor))
    .sort((left, right) => left - right);
  assert.deepEqual(cursors, [1, 2, 3, 4]);

  const session = await openSession(database.migrationUrl);
  try {
    const rows = await session.query<{ cursor: string }>(
      'select cursor from changesets where workspace_id = $1 order by cursor',
      [workspaceId],
    );
    assert.deepEqual(
      rows.map((row) => Number(row.cursor)),
      [1, 2, 3, 4],
    );
    const last = await session.query<{ last_cursor: string }>(
      'select last_cursor from workspace_cursors where workspace_id = $1',
      [workspaceId],
    );
    assert.equal(Number(last[0]?.last_cursor), 4);
  } finally {
    await session.close();
  }
});

await test('immutable rows: rejects an update or a delete on a stored revision', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const first = revision({ fileId: randomUUID(), path: 'notes/immutable.md' });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, changeset(workspaceId, [first]), 'digest-immutable'),
    ),
  );
  // A second revision gives `revision_parents` a row to protect.
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(
        actor,
        changeset(workspaceId, [
          revision({
            fileId: first.fileId,
            parents: [first.id],
            path: 'notes/immutable.md',
            text: '# second body\n',
          }),
        ]),
        'digest-immutable-2',
      ),
    ),
  );

  const owner = await openSession(database.migrationUrl);
  try {
    for (const table of [
      'revisions',
      'revision_parents',
      'contents',
      'changesets',
      'mutation_receipts',
    ]) {
      const updated = await owner.failure(
        `update ${table} set workspace_id = workspace_id where workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(updated.code, '23001');
      const deleted = await owner.failure(
        `delete from ${table} where workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(deleted.code, '23001');
    }
  } finally {
    await owner.close();
  }

  const runtime = await openSession(database.runtimeUrl, accountId);
  try {
    const denied = await runtime.failure(
      'update revisions set message = $2 where workspace_id = $1',
      [workspaceId, 'changed'],
    );
    assert.equal(denied.code, '42501');
  } finally {
    await runtime.close();
  }
});

await test('pooled identity: keeps no identity on a released connection', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const single = openWorkspaceStore(database.runtimeUrl, { poolSize: 1 });
  try {
    const only = revision({ fileId: randomUUID(), path: 'notes/pooled.md' });
    accepted(
      await single.transact(actor, workspaceId, (tx) =>
        tx.accept(actor, changeset(workspaceId, [only]), 'digest-pooled'),
      ),
    );

    assert.equal(await single.readPooledIdentity(), null);

    // The same connection now serves a stranger. A leaked identity would make
    // the workspace visible to it.
    const stranger = testActor(randomUUID(), [
      { workspaceId, actions: ['read', 'write'] },
    ]);
    await assert.rejects(
      () => single.transact(stranger, workspaceId, (tx) => tx.role(accountId)),
      WorkspaceUnavailableError,
    );
    assert.equal(await single.readPooledIdentity(), null);
  } finally {
    await single.close();
  }
});

await test('quota: rejects new content and keeps the earlier state', async () => {
  const quota = (1n << 20n) + 2000n;
  const { workspaceId, accountId } = await newWorkspace(quota);
  const actor = memberActor(accountId, workspaceId);
  const first = revision({ fileId: randomUUID(), path: 'notes/q1.md' });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, changeset(workspaceId, [first]), 'digest-q1'),
    ),
  );

  const second = revision({ fileId: randomUUID(), path: 'notes/q2.md' });
  const rejected = await store.transact(actor, workspaceId, (tx) =>
    tx.accept(actor, changeset(workspaceId, [second]), 'digest-q2'),
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, 'quota');

  const heads = await store.transact(actor, workspaceId, (tx) =>
    tx.heads([first.fileId, second.fileId]),
  );
  assert.equal(heads.get(first.fileId), first.id);
  assert.equal(heads.get(second.fileId), null);
  assert.equal(await countRows('revisions', workspaceId), 1);
  assert.equal(await countRows('contents', workspaceId), 1);
});

await test('quota: accepts a control operation on a full workspace', async () => {
  const quota = (1n << 20n) + 2000n;
  const { workspaceId, accountId } = await newWorkspace(quota);
  const actor = memberActor(accountId, workspaceId);
  const body = markdown('# control\n');
  const first = revision({
    fileId: randomUUID(),
    path: 'notes/control.md',
    content: body,
  });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, changeset(workspaceId, [first]), 'digest-control-1'),
    ),
  );
  const blocked = await store.transact(actor, workspaceId, (tx) =>
    tx.accept(
      actor,
      changeset(workspaceId, [
        revision({ fileId: randomUUID(), path: 'notes/blocked.md' }),
      ]),
      'digest-control-blocked',
    ),
  );
  assert.equal(blocked.ok, false);

  // The deletion reuses stored content, so it adds no new bytes and the
  // reserved control capacity keeps it acceptable.
  const removal = revision({
    fileId: first.fileId,
    parents: [first.id],
    path: 'notes/control.md',
    deleted: true,
    content: body,
  });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(
        actor,
        changeset(workspaceId, [removal]),
        'digest-control-delete',
      ),
    ),
  );
  assert.equal(await countRows('live_paths', workspaceId), 0);
});

await test('migrations: applies to an empty database and is a no operation the second time', async () => {
  const fresh = await createDisposableDatabase();
  try {
    const session = await openSession(fresh.migrationUrl);
    try {
      const tables = await session.query<{ total: number }>(
        `select count(*)::int as total from information_schema.tables
         where table_schema = 'public'`,
      );
      assert.ok((tables[0]?.total ?? 0) >= 21);
      const before = await session.query<{ total: number }>(
        'select count(*)::int as total from drizzle.__drizzle_migrations',
      );
      assert.equal(before[0]?.total, 2);

      await runMigrations({
        databaseUrl: fresh.migrationUrl,
        runtimePassword: 'notesapp_app_test_password',
      });

      const applied = await session.query<{ total: number }>(
        'select count(*)::int as total from drizzle.__drizzle_migrations',
      );
      assert.equal(applied[0]?.total, 2);
    } finally {
      await session.close();
    }
  } finally {
    await fresh.destroy();
  }
});

await test('content digests: rejects Markdown that does not match its digest', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const forged = revision({
    fileId: randomUUID(),
    path: 'notes/forged.md',
    content: {
      kind: 'markdown',
      digest: markdownDigest('# a different body\n'),
      text: '# the submitted body\n',
    },
  });

  const result = await store.transact(actor, workspaceId, (tx) =>
    tx.accept(actor, changeset(workspaceId, [forged]), 'digest-forged'),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'invalid_content');
    assert.deepEqual(result.error.fileIds, [forged.fileId]);
  }
  assert.equal(await countRows('contents', workspaceId), 0);
});

await test('content digests: an attachment must carry its object digest', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const objectId = randomUUID();
  const owner = await openSession(database.migrationUrl);
  try {
    await owner.query(
      `insert into attachment_objects (workspace_id, id, digest, size, media_type, state)
       values ($1, $2, 'sha256-object-digest', 24, 'image/png', 'finalized')`,
      [workspaceId, objectId],
    );
  } finally {
    await owner.close();
  }

  const wrong = revision({
    fileId: randomUUID(),
    path: 'attachments/one.png',
    content: { kind: 'attachment', digest: 'sha256-other', objectId },
  });
  const rejected = await store.transact(actor, workspaceId, (tx) =>
    tx.accept(
      actor,
      changeset(workspaceId, [wrong]),
      'digest-attachment-wrong',
    ),
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, 'invalid_content');

  const right = revision({
    fileId: randomUUID(),
    path: 'attachments/two.png',
    content: {
      kind: 'attachment',
      digest: 'sha256-object-digest',
      objectId,
    },
  });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, changeset(workspaceId, [right]), 'digest-attachment-ok'),
    ),
  );
});

await test('workspace boundaries: content cannot name an object of another workspace', async () => {
  const source = await newWorkspace();
  const target = await newWorkspace();
  const objectId = randomUUID();
  const owner = await openSession(database.migrationUrl);
  try {
    await owner.query(
      `insert into attachment_objects (workspace_id, id, digest, size, media_type, state)
       values ($1, $2, 'sha256-foreign', 24, 'image/png', 'finalized')`,
      [source.workspaceId, objectId],
    );
    const failure = await owner.failure(
      `insert into contents (workspace_id, digest, kind, size, object_id)
       values ($1, 'sha256-foreign', 'attachment', 24, $2)`,
      [target.workspaceId, objectId],
    );
    assert.equal(failure.code, '23503');
    assert.match(failure.message, /contents_object_fk/);
  } finally {
    await owner.close();
  }
});

await test('quota: a reused digest still needs room below the control reserve', async () => {
  const quota = (1n << 20n) + 2000n;
  const { workspaceId, accountId } = await newWorkspace(quota);
  const actor = memberActor(accountId, workspaceId);
  const body = markdown('# reuse\n');
  const first = revision({
    fileId: randomUUID(),
    path: 'notes/reuse-a.md',
    content: body,
  });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, changeset(workspaceId, [first]), 'digest-reuse-1'),
    ),
  );

  // The second file adds no content bytes, but its revision and its receipt
  // are still retained data, so it must fit below the reserve line.
  const second = revision({
    fileId: randomUUID(),
    path: 'notes/reuse-b.md',
    content: body,
  });
  const rejected = await store.transact(actor, workspaceId, (tx) =>
    tx.accept(actor, changeset(workspaceId, [second]), 'digest-reuse-2'),
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, 'quota');
  assert.equal(await countRows('revisions', workspaceId), 1);

  // A changeset that deletes every file it touches may use the reserve.
  const removal = revision({
    fileId: first.fileId,
    parents: [first.id],
    path: 'notes/reuse-a.md',
    deleted: true,
    content: body,
  });
  accepted(
    await store.transact(actor, workspaceId, (tx) =>
      tx.accept(
        actor,
        changeset(workspaceId, [removal]),
        'digest-reuse-delete',
      ),
    ),
  );
  assert.equal(await countRows('live_paths', workspaceId), 0);
});

await test('unavailable workspace: a non member gets a dedicated error', async () => {
  const { workspaceId } = await newWorkspace();
  const stranger = testActor(randomUUID(), [
    { workspaceId, actions: ['read', 'write'] },
  ]);
  const error = await thrownBy(() =>
    store.transact(stranger, workspaceId, (tx) => tx.role(stranger.accountId)),
  );
  assert.ok(error instanceof WorkspaceUnavailableError);
  assert.equal(isOperationalError(error), false);
});

await test('operational failures: a refused connection stays an infrastructure failure', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const secret = 'wrong-password-marker';
  const broken = openWorkspaceStore(
    withCredentials(database.runtimeUrl, runtimeRole, secret),
    { poolSize: 1 },
  );
  try {
    const error = await thrownBy(() =>
      broken.transact(actor, workspaceId, () => Promise.resolve(null)),
    );
    assert.ok(isOperationalError(error));
    assert.equal(error.kind, 'unavailable');
    assert.equal(inspect(error, { depth: 10 }).includes(secret), false);
  } finally {
    await broken.close();
  }
});

await test('operational failures: the reported cause carries no stored content', async () => {
  const { workspaceId, accountId } = await newWorkspace();
  const actor = memberActor(accountId, workspaceId);
  const marker = 'NOTESAPP-CONTENT-MARKER-4f19';
  // A null byte is valid in a JavaScript string and invalid in a PostgreSQL
  // text value, so the content insert fails with the note body still bound to
  // the statement.
  const body = markdown(`# ${marker}\u0000`);
  const only = revision({
    fileId: randomUUID(),
    path: `notes/${marker}.md`,
    content: body,
  });

  const error = await thrownBy(() =>
    store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, changeset(workspaceId, [only]), 'digest-marker'),
    ),
  );

  assert.ok(isOperationalError(error));
  const printed = inspect(error, { depth: 10 });
  assert.equal(printed.includes(marker), false);
  assert.equal(printed.includes(body.digest), false);
});

await test('acceptance time: server_time uses clock_timestamp', async () => {
  const session = await openSession(database.migrationUrl);
  try {
    const rows = await session.query<{
      table_name: string;
      column_default: string;
    }>(
      `select table_name, column_default from information_schema.columns
       where table_schema = 'public' and column_name = 'server_time'
       order by table_name`,
    );
    assert.deepEqual(
      rows.map((row) => row.table_name),
      ['changesets', 'revisions'],
    );
    for (const row of rows) {
      assert.match(row.column_default, /clock_timestamp\(\)/);
    }
  } finally {
    await session.close();
  }
});

await store.close();
await database.destroy();
