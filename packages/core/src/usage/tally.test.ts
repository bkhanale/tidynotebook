import assert from 'node:assert/strict';
import test from 'node:test';
import { zeroCounts } from './model.ts';
import { createUsageTally } from './tally.ts';

const account = '00000000-0000-4000-8000-000000000001';

await test('a count of an account adds to the account and to the installation', () => {
  const tally = createUsageTally();
  tally.add('2026-10', account, { ...zeroCounts, downloadBytes: 10 });
  tally.add('2026-10', null, { ...zeroCounts, publishedTransferBytes: 5 });
  tally.add('2026-10', null, { ...zeroCounts, objectWrites: 1 });
  assert.deepEqual(tally.pending('2026-10', account), {
    ...zeroCounts,
    downloadBytes: 10,
  });
  assert.deepEqual(tally.pending('2026-10', null), {
    publishedTransferBytes: 5,
    downloadBytes: 10,
    objectWrites: 1,
    objectReads: 0,
  });
  assert.deepEqual(tally.pending('2026-11', account), zeroCounts);
});

await test('a write that fails loses no count, and one that stores ends the sums', () => {
  const tally = createUsageTally();
  tally.add('2026-10', account, { ...zeroCounts, downloadBytes: 10 });
  const first = tally.take();
  assert.equal(first.length, 2);
  // A check while the write runs still sees the sums of the write.
  assert.equal(tally.pending('2026-10', account).downloadBytes, 10);
  tally.add('2026-10', account, { ...zeroCounts, downloadBytes: 3 });
  assert.equal(tally.pending('2026-10', account).downloadBytes, 13);
  tally.settle(first, false);
  assert.equal(tally.pending('2026-10', account).downloadBytes, 13);

  const second = tally.take();
  assert.deepEqual(
    second.find((entry) => entry.accountId === account)?.counts,
    { ...zeroCounts, downloadBytes: 13 },
  );
  tally.settle(second, true);
  assert.deepEqual(tally.pending('2026-10', account), zeroCounts);
  assert.deepEqual(tally.take(), []);
});

await test('a count keeps the month in which it happened', () => {
  const tally = createUsageTally();
  tally.add('2026-10', account, { ...zeroCounts, downloadBytes: 1 });
  tally.add('2026-11', account, { ...zeroCounts, downloadBytes: 2 });
  const months = tally
    .take()
    .filter((entry) => entry.accountId === account)
    .map((entry) => [entry.month, entry.counts.downloadBytes]);
  assert.deepEqual(months, [
    ['2026-10', 1],
    ['2026-11', 2],
  ]);
});
