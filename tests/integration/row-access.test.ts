/**
 * Row level security under the runtime role.
 *
 * The runtime role is the credential that the application server uses. It has
 * no DDL right, it cannot bypass row security, and it cannot run a migration.
 * Every check below therefore uses that role, not the schema owner.
 *
 * Start the service first:
 *
 * ```sh
 * sudo -n docker compose -f compose.test.yaml up -d --wait
 * ```
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  openWorkspaceStore,
  runMigrations,
  type WorkspaceStoreHandle,
} from '@notesapp/storage-server';
import {
  changeset,
  createDisposableDatabase,
  memberActor,
  openSession,
  revision,
  seedWorkspace,
  type TestDatabase,
  type TestSession,
} from './support/database.ts';

/** Every workspace scoped table that the policies protect. */
const scopedTables = [
  'memberships',
  'workspace_usage',
  'workspace_cursors',
  'files',
  'live_paths',
  'contents',
  'revisions',
  'revision_parents',
  'changesets',
  'mutation_receipts',
  'branches',
  'purge_markers',
  'audit_events',
  'sync_changes',
  'snapshots',
  'snapshot_items',
  'link_index',
  'shares',
  'attachment_objects',
] as const;

/** One seeded workspace and the identifiers that the checks use. */
type Seeded = {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly fileId: string;
  readonly firstRevisionId: string;
  readonly headRevisionId: string;
  readonly shareToken: string;
};

const database: TestDatabase = await createDisposableDatabase();
const store: WorkspaceStoreHandle = openWorkspaceStore(database.runtimeUrl, {
  poolSize: 4,
});

/** Fills every scoped table of one workspace. */
async function seedEverything(): Promise<Seeded> {
  const workspaceId = randomUUID();
  const accountId = randomUUID();
  await seedWorkspace(database, workspaceId, [{ accountId, role: 'owner' }]);
  const actor = memberActor(accountId, workspaceId);
  const first = revision({ fileId: randomUUID(), path: 'notes/first.md' });
  const second = revision({
    fileId: first.fileId,
    parents: [first.id],
    path: 'notes/first.md',
    text: '# second body\n',
  });
  const write = async (
    entries: Parameters<typeof changeset>[1],
    digest: string,
  ): Promise<void> => {
    const result = await store.transact(actor, workspaceId, (tx) =>
      tx.accept(actor, changeset(workspaceId, entries), digest),
    );
    if (!result.ok) assert.fail(`the seed was rejected: ${result.error.code}`);
  };
  await write([first], `seed-${workspaceId}-1`);
  await write([second], `seed-${workspaceId}-2`);

  const shareToken = randomUUID();
  const session = await openSession(database.migrationUrl);
  try {
    await session.query(
      `insert into attachment_objects (workspace_id, id, digest, size, media_type, state)
       values ($1, $2, 'sha256-object', 12, 'image/png', 'finalized')`,
      [workspaceId, randomUUID()],
    );
    await session.query(
      `insert into branches (workspace_id, id, file_id, base_revision_id, tip_revision_id, conflict_group_id, state)
       values ($1, $2, $3, $4, $4, $5, 'unresolved')`,
      [workspaceId, randomUUID(), first.fileId, first.id, randomUUID()],
    );
    await session.query(
      'insert into purge_markers (workspace_id, file_id) values ($1, $2)',
      [workspaceId, randomUUID()],
    );
    await session.query(
      `insert into audit_events (workspace_id, id, actor_account_id, action, target_kind)
       values ($1, $2, $3, 'share.create', 'share')`,
      [workspaceId, randomUUID(), accountId],
    );
    await session.query(
      `insert into snapshots (token_hash, workspace_id, account_id, cursor, item_count, page_size, expires_at)
       values ($1, $2, $3, 2, 1, 100, now() + interval '15 minutes')`,
      [`snapshot-${workspaceId}`, workspaceId, accountId],
    );
    await session.query(
      `insert into snapshot_items (token_hash, ordinal, workspace_id, file_id, revision_id)
       values ($1, 0, $2, $3, $4)`,
      [`snapshot-${workspaceId}`, workspaceId, first.fileId, second.id],
    );
    await session.query(
      `insert into link_index (workspace_id, source_file_id, source_revision_id, ordinal, target_file_id, source_text)
       values ($1, $2, $3, 0, null, 'Unresolved title')`,
      [workspaceId, first.fileId, second.id],
    );
    await session.query(
      `insert into shares (workspace_id, id, file_id, pinned_revision_id, token_hash, creator_account_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        workspaceId,
        randomUUID(),
        first.fileId,
        first.id,
        shareToken,
        accountId,
      ],
    );
  } finally {
    await session.close();
  }

  return {
    workspaceId,
    accountId,
    fileId: first.fileId,
    firstRevisionId: first.id,
    headRevisionId: second.id,
    shareToken,
  };
}

/** Counts the rows of one table that a session can read. */
async function visible(session: TestSession, table: string): Promise<number> {
  const rows = await session.query<{ total: number }>(
    `select count(*)::int as total from ${table}`,
  );
  return rows[0]?.total ?? -1;
}

/** Counts the readable rows of one table inside one workspace. */
async function visibleIn(
  session: TestSession,
  table: string,
  workspaceId: string,
): Promise<number> {
  const rows = await session.query<{ total: number }>(
    `select count(*)::int as total from ${table} where workspace_id = $1`,
    [workspaceId],
  );
  return rows[0]?.total ?? -1;
}

const owned: Seeded = await seedEverything();
const other: Seeded = await seedEverything();
const strangerId = randomUUID();
const setup = await openSession(database.migrationUrl);
try {
  await setup.query('insert into accounts (id) values ($1)', [strangerId]);
} finally {
  await setup.close();
}

await test('member visibility: reads the rows of its own workspaces only', async () => {
  const session = await openSession(database.runtimeUrl, owned.accountId);
  try {
    for (const table of scopedTables) {
      const mine = await visibleIn(session, table, owned.workspaceId);
      const theirs = await visibleIn(session, table, other.workspaceId);
      const total = await visible(session, table);
      assert.ok(mine > 0, `${table} must show rows of the own workspace`);
      assert.equal(theirs, 0, `${table} must hide the other workspace`);
      assert.equal(total, mine, `${table} must show nothing else`);
    }
    assert.equal(await visible(session, 'workspaces'), 1);
    assert.equal(await visible(session, 'accounts'), 1);
  } finally {
    await session.close();
  }
});

await test('member visibility: cannot write into another workspace', async () => {
  const session = await openSession(database.runtimeUrl, owned.accountId);
  try {
    const failure = await session.failure(
      `insert into files (workspace_id, id, path, kind)
       values ($1, $2, 'notes/forced.md', 'note')`,
      [other.workspaceId, randomUUID()],
    );
    assert.equal(failure.code, '42501');
    assert.match(failure.message, /row-level security/i);
  } finally {
    await session.close();
  }
});

await test('non members and anonymous readers: shows nothing to an account without a membership', async () => {
  const session = await openSession(database.runtimeUrl, strangerId);
  try {
    for (const table of scopedTables) {
      assert.equal(await visible(session, table), 0, table);
    }
    assert.equal(await visible(session, 'workspaces'), 0);
    const failure = await session.failure(
      `insert into files (workspace_id, id, path, kind)
       values ($1, $2, 'notes/stranger.md', 'note')`,
      [owned.workspaceId, randomUUID()],
    );
    assert.equal(failure.code, '42501');
  } finally {
    await session.close();
  }
});

await test('non members and anonymous readers: shows nothing without an identity setting', async () => {
  const session = await openSession(database.runtimeUrl);
  try {
    for (const table of scopedTables) {
      assert.equal(await visible(session, table), 0, table);
    }
    assert.equal(await visible(session, 'workspaces'), 0);
    assert.equal(await visible(session, 'accounts'), 0);
  } finally {
    await session.close();
  }
});

await test('runtime role limits: cannot turn row security off', async () => {
  const session = await openSession(database.runtimeUrl, owned.accountId);
  try {
    await session.query('set row_security = off');
    // PostgreSQL rejects the read, because the role has no BYPASSRLS
    // attribute. A version that accepted the read would still have to apply
    // the policy, so the second branch checks the same guarantee.
    let readable: number | null = null;
    let code = '';
    try {
      readable = await visible(session, 'files');
    } catch (error) {
      code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : '';
    }
    if (readable === null) {
      assert.equal(code, '42501');
    } else {
      assert.equal(readable, 1);
    }
    await session.query('set row_security = on');
    assert.equal(await visible(session, 'files'), 1);
  } finally {
    await session.close();
  }
});

await test('runtime role limits: cannot run DDL', async () => {
  const session = await openSession(database.runtimeUrl, owned.accountId);
  try {
    const created = await session.failure(
      'create table row_access_probe (id integer)',
    );
    assert.equal(created.code, '42501');
    const altered = await session.failure(
      'alter table files add column probe integer',
    );
    assert.equal(altered.code, '42501');
    const dropped = await session.failure('drop table live_paths');
    assert.equal(dropped.code, '42501');
  } finally {
    await session.close();
  }
});

await test('runtime role limits: cannot read or run the migration bookkeeping', async () => {
  const session = await openSession(database.runtimeUrl, owned.accountId);
  try {
    const denied = await session.failure(
      'select count(*) from drizzle.__drizzle_migrations',
    );
    assert.equal(denied.code, '42501');
  } finally {
    await session.close();
  }
  await assert.rejects(() =>
    runMigrations({
      databaseUrl: database.runtimeUrl,
      runtimePassword: 'notesapp_app_test_password',
    }),
  );
});

await test('public share lookup: returns the pinned revision for a valid token hash', async () => {
  const session = await openSession(database.runtimeUrl);
  try {
    const rows = await session.query<{
      workspace_id: string;
      pinned_revision_id: string;
      path: string;
      markdown: string;
    }>('select * from notesapp_share_lookup($1)', [owned.shareToken]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.workspace_id, owned.workspaceId);
    assert.equal(rows[0]?.pinned_revision_id, owned.firstRevisionId);
    assert.notEqual(rows[0]?.pinned_revision_id, owned.headRevisionId);
    assert.equal(rows[0]?.path, 'notes/first.md');
    assert.equal(rows[0]?.markdown, '# notes/first.md\n');
  } finally {
    await session.close();
  }
});

await test('public share lookup: grants no table read to an anonymous reader', async () => {
  const session = await openSession(database.runtimeUrl);
  try {
    assert.equal(await visible(session, 'shares'), 0);
    assert.equal(await visible(session, 'revisions'), 0);
    assert.equal(await visible(session, 'contents'), 0);
    const rows = await session.query<{ share_id: string }>(
      'select share_id from notesapp_share_lookup($1)',
      [randomUUID()],
    );
    assert.equal(rows.length, 0);
  } finally {
    await session.close();
  }
});

await test('public share lookup: returns nothing for a revoked or an expired share', async () => {
  const revokedToken = randomUUID();
  const expiredToken = randomUUID();
  const owner = await openSession(database.migrationUrl);
  try {
    await owner.query(
      `insert into shares (workspace_id, id, file_id, pinned_revision_id, token_hash, creator_account_id, revoked_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [
        owned.workspaceId,
        randomUUID(),
        owned.fileId,
        owned.firstRevisionId,
        revokedToken,
        owned.accountId,
      ],
    );
    await owner.query(
      `insert into shares (workspace_id, id, file_id, pinned_revision_id, token_hash, creator_account_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() - interval '1 minute')`,
      [
        owned.workspaceId,
        randomUUID(),
        owned.fileId,
        owned.firstRevisionId,
        expiredToken,
        owned.accountId,
      ],
    );
  } finally {
    await owner.close();
  }

  const session = await openSession(database.runtimeUrl);
  try {
    for (const token of [revokedToken, expiredToken]) {
      const rows = await session.query<{ share_id: string }>(
        'select share_id from notesapp_share_lookup($1)',
        [token],
      );
      assert.equal(rows.length, 0);
    }
  } finally {
    await session.close();
  }
});

await test('membership policy: is not recursive', async () => {
  const session = await openSession(database.runtimeUrl, owned.accountId);
  try {
    const plan = await session.query<{ 'QUERY PLAN': string }>(
      'explain select workspace_id, account_id from memberships',
    );
    assert.ok(plan.length > 0);
    const joined = await session.query<{ total: number }>(
      `select count(*)::int as total
       from memberships m1
       join memberships m2 on m1.workspace_id = m2.workspace_id`,
    );
    assert.equal(joined[0]?.total, 1);
    const nested = await session.query<{ total: number }>(
      `select count(*)::int as total from memberships m
       where exists (
         select 1 from memberships inner_m
         where inner_m.workspace_id = m.workspace_id
       )`,
    );
    assert.equal(nested[0]?.total, 1);
  } finally {
    await session.close();
  }
});

// One workspace with three roles, for the privilege escalation checks below.
const escalation = {
  workspaceId: randomUUID(),
  ownerId: randomUUID(),
  adminId: randomUUID(),
  viewerId: randomUUID(),
};
await seedWorkspace(database, escalation.workspaceId, [
  { accountId: escalation.ownerId, role: 'owner' },
  { accountId: escalation.adminId, role: 'admin' },
  { accountId: escalation.viewerId, role: 'viewer' },
]);

await test('privilege escalation: a viewer cannot add a membership', async () => {
  const session = await openSession(database.runtimeUrl, escalation.viewerId);
  try {
    const failure = await session.failure(
      `insert into memberships (workspace_id, account_id, role)
       values ($1, $2, 'owner')`,
      [escalation.workspaceId, randomUUID()],
    );
    assert.equal(failure.code, '42501');
    assert.match(failure.message, /row-level security/i);
  } finally {
    await session.close();
  }
});

await test('privilege escalation: a viewer cannot promote itself', async () => {
  const session = await openSession(database.runtimeUrl, escalation.viewerId);
  try {
    const changed = await session.query<{ account_id: string }>(
      `update memberships set role = 'owner'
       where workspace_id = $1 and account_id = $2
       returning account_id`,
      [escalation.workspaceId, escalation.viewerId],
    );
    assert.equal(changed.length, 0);
    const current = await session.query<{ role: string }>(
      'select role from memberships where account_id = $1',
      [escalation.viewerId],
    );
    assert.equal(current[0]?.role, 'viewer');
  } finally {
    await session.close();
  }
});

await test('privilege escalation: a viewer cannot remove a co-member', async () => {
  const session = await openSession(database.runtimeUrl, escalation.viewerId);
  try {
    const removed = await session.query<{ account_id: string }>(
      `delete from memberships
       where workspace_id = $1 and account_id = $2
       returning account_id`,
      [escalation.workspaceId, escalation.adminId],
    );
    assert.equal(removed.length, 0);
    assert.equal(await visible(session, 'memberships'), 3);
  } finally {
    await session.close();
  }
});

await test('privilege escalation: a viewer cannot rename the workspace', async () => {
  const session = await openSession(database.runtimeUrl, escalation.viewerId);
  try {
    const renamed = await session.query<{ id: string }>(
      "update workspaces set name = 'taken over' where id = $1 returning id",
      [escalation.workspaceId],
    );
    assert.equal(renamed.length, 0);
  } finally {
    await session.close();
  }
});

await test('privilege escalation: a member cannot raise its own quota', async () => {
  const session = await openSession(database.runtimeUrl, escalation.ownerId);
  try {
    const failure = await session.failure(
      'update workspace_usage set quota_bytes = 1 where workspace_id = $1',
      [escalation.workspaceId],
    );
    assert.equal(failure.code, '42501');
  } finally {
    await session.close();
  }
});

await test('privilege escalation: a member cannot reset the commit cursor', async () => {
  const session = await openSession(database.runtimeUrl, escalation.ownerId);
  try {
    const failure = await session.failure(
      'update workspace_cursors set last_cursor = 0 where workspace_id = $1',
      [escalation.workspaceId],
    );
    assert.equal(failure.code, '42501');
  } finally {
    await session.close();
  }
});

await test('membership changes: an admin may edit a co-member but not create an owner', async () => {
  const session = await openSession(database.runtimeUrl, escalation.adminId);
  try {
    const promoted = await session.query<{ role: string }>(
      `update memberships set role = 'editor'
       where workspace_id = $1 and account_id = $2
       returning role`,
      [escalation.workspaceId, escalation.viewerId],
    );
    assert.equal(promoted[0]?.role, 'editor');

    const refused = await session.failure(
      `update memberships set role = 'owner'
       where workspace_id = $1 and account_id = $2`,
      [escalation.workspaceId, escalation.viewerId],
    );
    assert.equal(refused.code, '42501');

    const restored = await session.query<{ role: string }>(
      `update memberships set role = 'viewer'
       where workspace_id = $1 and account_id = $2
       returning role`,
      [escalation.workspaceId, escalation.viewerId],
    );
    assert.equal(restored[0]?.role, 'viewer');
  } finally {
    await session.close();
  }
});

await test('privileged functions: a stranger cannot move a cursor or add usage', async () => {
  const session = await openSession(database.runtimeUrl, strangerId);
  try {
    const cursor = await session.failure('select notesapp_next_cursor($1)', [
      escalation.workspaceId,
    ]);
    assert.equal(cursor.code, '42501');
    const usage = await session.failure(
      'select notesapp_add_usage($1, 1000::bigint)',
      [escalation.workspaceId],
    );
    assert.equal(usage.code, '42501');
  } finally {
    await session.close();
  }
});

await test('privileged functions: usage cannot become negative', async () => {
  const session = await openSession(database.runtimeUrl, escalation.ownerId);
  try {
    const failure = await session.failure(
      'select notesapp_add_usage($1, (-1000000)::bigint)',
      [escalation.workspaceId],
    );
    assert.equal(failure.code, '23514');
  } finally {
    await session.close();
  }
});

await store.close();
await database.destroy();
