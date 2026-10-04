import assert from 'node:assert/strict';
import test from 'node:test';
import { openUsage } from './limits.ts';
import { createUsageMeter } from './meter.ts';
import {
  noUsageCaps,
  sumCounts,
  zeroCounts,
  type MonthlyCounts,
  type TransferLimits,
  type UsageCaps,
} from './model.ts';
import type { MonthlyUsageStore, UsageSubjectKey } from './ports.ts';
import type { UsageEntry } from './tally.ts';

const owner = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-0000000000aa';

/** One monthly table that several meters share, as two processes do. */
function sharedStore(limits: TransferLimits): MonthlyUsageStore & {
  rows: Map<string, MonthlyCounts>;
  reads: { subjects: number; totals: number };
  failWrites: boolean;
} {
  const rows = new Map<string, MonthlyCounts>();
  const reads = { subjects: 0, totals: 0 };
  const store = {
    rows,
    reads,
    failWrites: false,
    addUsage(entries: readonly UsageEntry[]): Promise<void> {
      if (store.failWrites) return Promise.reject(new Error('down'));
      for (const entry of entries) {
        const key = `${entry.month}/${entry.accountId ?? ''}`;
        rows.set(key, sumCounts(rows.get(key) ?? zeroCounts, entry.counts));
      }
      return Promise.resolve();
    },
    usageSubject(key: UsageSubjectKey) {
      reads.subjects += 1;
      const known =
        'accountId' in key
          ? key.accountId === owner
          : key.workspaceId === workspace;
      return Promise.resolve(known ? { accountId: owner, limits } : null);
    },
    storedUsage(month: string, accountId: string | null) {
      reads.totals += 1;
      return Promise.resolve({
        account:
          accountId === null
            ? zeroCounts
            : (rows.get(`${month}/${accountId}`) ?? zeroCounts),
        installation: rows.get(`${month}/`) ?? zeroCounts,
      });
    },
  };
  return store;
}

const october = (): Date => new Date('2026-10-04T10:00:00.000Z');

function meterOf(
  store: MonthlyUsageStore,
  caps: UsageCaps = noUsageCaps,
  clock: () => Date = october,
) {
  return createUsageMeter({ store, caps, clock, subjectTtlMs: 0 });
}

await test('with no limit and no cap a check reads no total and closes nothing', async () => {
  const store = sharedStore({
    publishedTransferBytes: null,
    downloadBytes: null,
  });
  const meter = meterOf(store);
  meter.countDownload(owner, 10_000);
  assert.deepEqual(await meter.accountState(owner), openUsage);
  assert.deepEqual(await meter.installationState(), openUsage);
  assert.deepEqual(await meter.publishedState(workspace), {
    accountId: owner,
    state: openUsage,
  });
  assert.equal(store.reads.totals, 0);
});

await test('a check adds the sum of its own process to the stored total of another', async () => {
  const store = sharedStore({
    publishedTransferBytes: 100,
    downloadBytes: 100,
  });
  const one = meterOf(store);
  const two = meterOf(store);
  one.countPublished(owner, 60);
  // The other process sees nothing before the first one writes.
  assert.equal(
    (await two.publishedState(workspace)).state.publishedPagesClosed,
    false,
  );
  await one.flush();
  two.countPublished(owner, 39);
  assert.equal(
    (await two.publishedState(workspace)).state.publishedPagesClosed,
    false,
  );
  two.countPublished(owner, 1);
  assert.equal(
    (await two.publishedState(workspace)).state.publishedPagesClosed,
    true,
  );
  assert.equal(
    (await one.publishedState(workspace)).state.publishedPagesClosed,
    false,
  );
  await two.flush();
  assert.equal(
    (await one.publishedState(workspace)).state.publishedPagesClosed,
    true,
  );
  // The installation row holds every byte, the account row its own.
  assert.equal(store.rows.get('2026-10/')?.publishedTransferBytes, 100);
  assert.equal(store.rows.get(`2026-10/${owner}`)?.publishedTransferBytes, 100);
});

await test('a reader path byte of no link counts for the installation only', async () => {
  const store = sharedStore({
    publishedTransferBytes: null,
    downloadBytes: null,
  });
  const meter = meterOf(store, { ...noUsageCaps, publishedTransferBytes: 50 });
  meter.countPublished(null, 50);
  await meter.flush();
  assert.equal(store.rows.get(`2026-10/${owner}`), undefined);
  assert.equal(
    (await meter.publishedState(workspace)).state.publishedPagesClosed,
    true,
  );
});

await test('the object calls count against the caps of the installation', async () => {
  const store = sharedStore({
    publishedTransferBytes: null,
    downloadBytes: null,
  });
  const meter = meterOf(store, {
    ...noUsageCaps,
    objectWrites: 2,
    objectReads: 1,
  });
  meter.countObjectCall('write');
  assert.equal((await meter.installationState()).uploadsPaused, false);
  meter.countObjectCall('write');
  meter.countObjectCall('read');
  assert.deepEqual(await meter.installationState(), {
    ...openUsage,
    uploadsPaused: true,
    imagesPaused: true,
  });
  // Every account meets the caps of the installation.
  assert.equal((await meter.accountState(owner)).imagesPaused, true);
});

await test('a failed write keeps the counts for the next write', async () => {
  const store = sharedStore({
    publishedTransferBytes: null,
    downloadBytes: 10,
  });
  const meter = meterOf(store);
  meter.countDownload(owner, 6);
  store.failWrites = true;
  await assert.rejects(meter.flush());
  // The process still counts what it could not write.
  meter.countDownload(owner, 4);
  assert.equal((await meter.accountState(owner)).downloadsPaused, true);
  store.failWrites = false;
  await meter.flush();
  assert.equal(store.rows.get(`2026-10/${owner}`)?.downloadBytes, 10);
  await meter.flush();
  assert.equal(store.rows.get(`2026-10/${owner}`)?.downloadBytes, 10);
});

await test('two writes at once store each count once', async () => {
  const store = sharedStore({
    publishedTransferBytes: null,
    downloadBytes: null,
  });
  const meter = meterOf(store);
  meter.countDownload(owner, 5);
  const first = meter.flush();
  meter.countDownload(owner, 7);
  await Promise.all([first, meter.flush()]);
  assert.equal(store.rows.get(`2026-10/${owner}`)?.downloadBytes, 12);
});

await test('the account month shows the counts and the end of the month', async () => {
  const store = sharedStore({
    publishedTransferBytes: 1000,
    downloadBytes: 20,
  });
  const meter = meterOf(store);
  meter.countDownload(owner, 20);
  meter.countPublished(owner, 3);
  const month = await meter.accountMonth(owner);
  assert.deepEqual(month, {
    month: '2026-10',
    endsAt: '2026-11-01T00:00:00.000Z',
    counts: { ...zeroCounts, downloadBytes: 20, publishedTransferBytes: 3 },
    state: { ...openUsage, downloadsPaused: true },
  });
});

await test('a new month starts again from zero', async () => {
  const store = sharedStore({
    publishedTransferBytes: null,
    downloadBytes: 10,
  });
  let now = october();
  const meter = meterOf(store, noUsageCaps, () => now);
  meter.countDownload(owner, 10);
  assert.equal((await meter.accountState(owner)).downloadsPaused, true);
  now = new Date('2026-11-01T00:00:00.000Z');
  assert.equal((await meter.accountState(owner)).downloadsPaused, false);
  await meter.flush();
  assert.equal(store.rows.get(`2026-10/${owner}`)?.downloadBytes, 10);
});

await test('a check keeps the limits of an account for the time it is given', async () => {
  const store = sharedStore({
    publishedTransferBytes: null,
    downloadBytes: null,
  });
  let now = october().getTime();
  const meter = createUsageMeter({
    store,
    caps: noUsageCaps,
    clock: () => new Date(now),
    subjectTtlMs: 10_000,
  });
  await meter.publishedState(workspace);
  await meter.publishedState(workspace);
  assert.equal(store.reads.subjects, 1);
  now += 10_000;
  await meter.publishedState(workspace);
  assert.equal(store.reads.subjects, 2);
  // The account page always reads the limits again.
  await meter.accountMonth(owner);
  await meter.accountMonth(owner);
  assert.equal(store.reads.subjects, 4);
});

await test('a count that is not a whole positive number counts nothing', async () => {
  const store = sharedStore({
    publishedTransferBytes: null,
    downloadBytes: null,
  });
  const meter = meterOf(store);
  meter.countDownload(owner, 0);
  meter.countDownload(owner, -5);
  meter.countDownload(owner, 1.5);
  meter.countPublished(null, Number.NaN);
  await meter.flush();
  assert.equal(store.rows.size, 0);
});
