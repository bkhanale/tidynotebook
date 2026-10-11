import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationalError, zeroCounts } from '@notesapp/core';
import { storedUsageOf, usageArrays, usageSubjectOf } from './usage-rows.ts';

const account = '00000000-0000-4000-8000-000000000001';

await test('the stored totals read each bigint text as a count', () => {
  assert.deepEqual(
    storedUsageOf({
      account_published_transfer_bytes: '1',
      account_download_bytes: '2',
      account_object_writes: '0',
      account_object_reads: '0',
      installation_published_transfer_bytes: '9007199254740991',
      installation_download_bytes: '4',
      installation_object_writes: '5',
      installation_object_reads: '6',
    }),
    {
      account: { ...zeroCounts, publishedTransferBytes: 1, downloadBytes: 2 },
      installation: {
        publishedTransferBytes: 9007199254740991,
        downloadBytes: 4,
        objectWrites: 5,
        objectReads: 6,
      },
    },
  );
});

await test('a count that no answer can carry is a defect of a writer', () => {
  for (const bad of ['-1', '9007199254740993', 'many', null, undefined])
    assert.throws(
      () =>
        storedUsageOf({
          account_published_transfer_bytes: bad,
          account_download_bytes: '0',
          account_object_writes: '0',
          account_object_reads: '0',
          installation_published_transfer_bytes: '0',
          installation_download_bytes: '0',
          installation_object_writes: '0',
          installation_object_reads: '0',
        }),
      OperationalError,
      String(bad),
    );
  assert.throws(() => storedUsageOf(undefined), OperationalError);
});

await test('the subject of a limit is the account and its two limits, or none', () => {
  assert.equal(usageSubjectOf(undefined), null);
  assert.deepEqual(
    usageSubjectOf({
      account_id: account,
      published_transfer_limit_bytes: '100',
      download_limit_bytes: null,
    }),
    {
      accountId: account,
      limits: { publishedTransferBytes: 100, downloadBytes: null },
    },
  );
  assert.throws(() => usageSubjectOf({ account_id: 7 }), OperationalError);
});

await test('a write sends each sum as one position of six arrays', () => {
  assert.deepEqual(
    usageArrays([
      {
        month: '2026-10',
        accountId: account,
        counts: { ...zeroCounts, downloadBytes: 3 },
      },
      {
        month: '2026-10',
        accountId: null,
        counts: {
          publishedTransferBytes: 1,
          downloadBytes: 3,
          objectWrites: 4,
          objectReads: 5,
        },
      },
    ]),
    [
      ['2026-10-01', '2026-10-01'],
      [account, null],
      [0, 1],
      [3, 3],
      [0, 4],
      [0, 5],
    ],
  );
});
