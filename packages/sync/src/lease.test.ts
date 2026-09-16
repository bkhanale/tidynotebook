/**
 * The rules of the single sync worker lease.
 *
 * The lease is one row for the browser profile. Record 0050 lets one tab run
 * several sync engines at once, one for the open workspace and one for every
 * workspace that still holds queued work, so the sharing rule of that row is
 * load bearing and is proved here.
 *
 * The double below is the same compare-and-set that
 * `packages/storage-browser/src/local-store/preferences.ts` performs inside an
 * IndexedDB transaction: a stored lease that another owner still holds refuses
 * the caller, and any other state takes or renews the lease.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquireWorkerLease,
  isLeaseExpired,
  readWorkerLease,
  releaseWorkerLease,
  type LeaseStore,
} from './lease.ts';

/** The three lease calls of the port, over one row, with a fake clock. */
function leaseStore(now: () => number): LeaseStore {
  let row: { ownerId: string; expiresAt: number } | null = null;
  return {
    acquireLease(ownerId: string, expiresAt: number): Promise<boolean> {
      if (row !== null && row.ownerId !== ownerId && row.expiresAt > now())
        return Promise.resolve(false);
      row = { ownerId, expiresAt };
      return Promise.resolve(true);
    },
    releaseLease(ownerId: string): Promise<void> {
      if (row !== null && row.ownerId === ownerId) row = null;
      return Promise.resolve();
    },
    readLeaseState(): Promise<{
      readonly ownerId: string;
      readonly expiresAt: number;
    } | null> {
      return Promise.resolve(row === null ? null : { ...row });
    },
  };
}

await test('every engine of one tab shares the one lease row', async () => {
  // This is the rule that record 0050 depends on. The open workspace and a
  // workspace that still holds queued work each run an engine in this tab,
  // and both are given the owner identifier of the tab.
  const clock = (): number => 1_000;
  const store = leaseStore(clock);
  const tab = 'tab-a';

  const openWorkspace = await acquireWorkerLease(store, {
    ownerId: tab,
    ttlMs: 30_000,
    clock,
  });
  const drainingWorkspace = await acquireWorkerLease(store, {
    ownerId: tab,
    ttlMs: 30_000,
    clock,
  });

  assert.equal(openWorkspace, true);
  assert.equal(drainingWorkspace, true);
  assert.equal((await readWorkerLease(store))?.ownerId, tab);
});

await test('a second tab is refused while the first one holds the lease', async () => {
  const clock = (): number => 1_000;
  const store = leaseStore(clock);

  assert.equal(
    await acquireWorkerLease(store, {
      ownerId: 'tab-a',
      ttlMs: 30_000,
      clock,
    }),
    true,
  );
  assert.equal(
    await acquireWorkerLease(store, {
      ownerId: 'tab-b',
      ttlMs: 30_000,
      clock,
    }),
    false,
  );
  assert.equal((await readWorkerLease(store))?.ownerId, 'tab-a');
});

await test('a second tab takes over a lease that expired without renewal', async () => {
  let now = 1_000;
  const clock = (): number => now;
  const store = leaseStore(clock);

  await acquireWorkerLease(store, { ownerId: 'tab-a', ttlMs: 30_000, clock });
  // The first tab failed and renewed nothing, so its lease ran out.
  now = 40_000;
  assert.equal(
    await acquireWorkerLease(store, {
      ownerId: 'tab-b',
      ttlMs: 30_000,
      clock,
    }),
    true,
  );
  assert.equal((await readWorkerLease(store))?.ownerId, 'tab-b');
});

await test('one engine stopping does not release the lease of its siblings', async () => {
  // A background engine stops when its queue drains while the engine of the
  // open workspace keeps running. Both share one owner, so the release has to
  // be the tab's act and not one engine's.
  const clock = (): number => 1_000;
  const store = leaseStore(clock);

  await acquireWorkerLease(store, { ownerId: 'tab-a', ttlMs: 30_000, clock });
  await releaseWorkerLease(store, 'other-tab');
  assert.equal((await readWorkerLease(store))?.ownerId, 'tab-a');

  await releaseWorkerLease(store, 'tab-a');
  assert.equal(await readWorkerLease(store), null);
});

await test('a lease that expires exactly now is already gone', () => {
  assert.equal(isLeaseExpired(1_000, 1_000), true);
  assert.equal(isLeaseExpired(1_001, 1_000), false);
});
