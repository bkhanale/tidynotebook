/**
 * The functions of the monthly counts in the database (record 0193,
 * migration 0031).
 *
 * The store of `openCoordination` adds the sums of a process and reads the
 * totals through the functions of the migration, which the runtime role
 * reaches and nothing else. Two processes write at the same time, so the
 * write locks its rows in one fixed order: two writes can then wait for each
 * other but never deadlock.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { zeroCounts } from '@notesapp/core';
import { openCoordination } from '@notesapp/storage-server';
import {
  createDisposableDatabase,
  openSession,
  seedWorkspace,
} from './support/database.ts';

const database = await createDisposableDatabase();
const coordination = openCoordination(database.runtimeUrl, { poolSize: 4 });

/**
 * Accounts whose identifiers sort in the order of their index, each the
 * owner of one workspace.
 */
const accounts = Array.from(
  { length: 6 },
  (_, index) =>
    `${String(index + 1)}0000000-0000-4000-8000-${randomUUID().slice(-12)}`,
);
const workspaces = accounts.map(() => randomUUID());
for (const [index, accountId] of accounts.entries())
  await seedWorkspace(database, workspaces[index] ?? '', [
    { accountId, role: 'owner' },
  ]);

/** The statement that a process runs to add its sums. */
const addStatement = `select notesapp_add_monthly_usage($1::date[], $2::uuid[],
  $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[])`;

/** The arguments of one write of one download byte for each account. */
function oneByteEach(month: string, ids: readonly string[]): unknown[] {
  return [
    ids.map(() => month),
    ids,
    ids.map(() => 0),
    ids.map(() => 1),
    ids.map(() => 0),
    ids.map(() => 0),
  ];
}

await test('the sums of a write reach their rows and the totals read them', async () => {
  const [first, second] = accounts;
  assert.ok(first !== undefined && second !== undefined);
  await coordination.addUsage([
    {
      month: '2026-07',
      accountId: first,
      counts: { ...zeroCounts, downloadBytes: 10, publishedTransferBytes: 3 },
    },
    {
      month: '2026-07',
      accountId: null,
      counts: {
        publishedTransferBytes: 3,
        downloadBytes: 10,
        objectWrites: 2,
        objectReads: 1,
      },
    },
    // A sum of an account that does not exist adds nothing and blocks no
    // other sum.
    {
      month: '2026-07',
      accountId: randomUUID(),
      counts: { ...zeroCounts, downloadBytes: 99 },
    },
  ]);
  await coordination.addUsage([
    {
      month: '2026-07',
      accountId: first,
      counts: { ...zeroCounts, downloadBytes: 5 },
    },
  ]);
  assert.deepEqual(await coordination.storedUsage('2026-07', first), {
    account: { ...zeroCounts, downloadBytes: 15, publishedTransferBytes: 3 },
    installation: {
      publishedTransferBytes: 3,
      downloadBytes: 10,
      objectWrites: 2,
      objectReads: 1,
    },
  });
  assert.deepEqual(await coordination.storedUsage('2026-07', second), {
    account: zeroCounts,
    installation: {
      publishedTransferBytes: 3,
      downloadBytes: 10,
      objectWrites: 2,
      objectReads: 1,
    },
  });
  // Another month starts from zero.
  assert.deepEqual(await coordination.storedUsage('2026-08', first), {
    account: zeroCounts,
    installation: zeroCounts,
  });
  // The subject of a limit is the account itself, or the owner of a
  // workspace, with the two limits of the account.
  assert.deepEqual(await coordination.usageSubject({ accountId: first }), {
    accountId: first,
    limits: { publishedTransferBytes: null, downloadBytes: null },
  });
  assert.deepEqual(
    await coordination.usageSubject({ workspaceId: workspaces[1] ?? '' }),
    {
      accountId: second,
      limits: { publishedTransferBytes: null, downloadBytes: null },
    },
  );
  assert.equal(
    await coordination.usageSubject({ workspaceId: randomUUID() }),
    null,
  );
});

await test('a write locks its rows in one order, so two writes never deadlock', async () => {
  // Review of PR 290. The rows of one write were locked in the order that
  // the grouping of the statement gave, which no rule fixed. Two processes
  // that wrote overlapping sums in two orders could each hold a row that the
  // other waited for. The order is the month, then the installation, then
  // each account by its identifier.
  const month = '2026-09-01';
  const [lowest, ...higher] = accounts;
  assert.ok(lowest !== undefined);
  await coordination.addUsage(
    accounts.map((accountId) => ({
      month: '2026-09',
      accountId,
      counts: { ...zeroCounts, downloadBytes: 1 },
    })),
  );
  const holder = await openSession(database.runtimeUrl);
  const writer = await openSession(database.runtimeUrl);
  const observer = await openSession(database.runtimeUrl);
  const owner = await openSession(database.migrationUrl);
  try {
    // One process holds the first row of the order in an open write.
    await holder.query('begin');
    await holder.query(addStatement, oneByteEach(month, [lowest]));
    // Another process writes every row, named in the reverse order. Its
    // planner may group the sums by a hash, which keeps no order, so the
    // order of the locks cannot rest on the plan of the grouping.
    await writer.query('set enable_sort = off');
    const writerPid = (
      await writer.query<{ pid: number }>('select pg_backend_pid() as pid')
    )[0]?.pid;
    // The write ends when the first process ends its write. A failure of it
    // is kept, so it cannot hide the failure of a check below.
    const written = writer
      .query(addStatement, oneByteEach(month, [...accounts].reverse()))
      .then(
        () => null,
        (error: unknown) => error,
      );
    // It waits on the first row of the order before it locks any other.
    for (let attempt = 0; ; attempt += 1) {
      const waiting = await observer.query<{ waiting: boolean }>(
        `select wait_event_type = 'Lock' as waiting from pg_stat_activity
          where pid = $1`,
        [writerPid],
      );
      if (waiting[0]?.waiting === true) break;
      assert.ok(attempt < 400, 'the second write never waited');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await owner.query('begin');
    const free = await owner.query<{ account_id: string }>(
      `select account_id::text from monthly_usage
        where month = $1 and account_id = any($2::uuid[])
        for update nowait`,
      [month, higher],
    );
    assert.equal(free.length, higher.length);
    await owner.query('rollback');
    await holder.query('commit');
    assert.equal(await written, null);
    const stored = await coordination.storedUsage('2026-09', lowest);
    assert.equal(stored.account.downloadBytes, 3);
  } finally {
    await owner.close();
    await holder.close();
    await writer.close();
    await observer.close();
  }
});

await test('two writes of overlapping sums in two orders both end', async () => {
  const month = '2026-10';
  const entries = accounts.map((accountId) => ({
    month,
    accountId,
    counts: { ...zeroCounts, objectReads: 1 },
  }));
  const reversed = [...entries].reverse();
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      coordination.addUsage(index % 2 === 0 ? entries : reversed),
    ),
  );
  for (const accountId of accounts)
    assert.equal(
      (await coordination.storedUsage(month, accountId)).account.objectReads,
      20,
    );
});

await coordination.close();
await database.destroy();
