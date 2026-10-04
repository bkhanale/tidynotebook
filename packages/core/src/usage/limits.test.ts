import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checksNothing,
  gateRefusal,
  openUsage,
  reached,
  usageGateOf,
  usageState,
} from './limits.ts';
import { noTransferLimits, noUsageCaps, zeroCounts } from './model.ts';
import { nextMonthStart, secondsToNextMonth } from './month.ts';

await test('a count reaches a limit at the limit, and never reaches no limit', () => {
  assert.equal(reached(99, 100), false);
  assert.equal(reached(100, 100), true);
  assert.equal(reached(101, 100), true);
  assert.equal(reached(Number.MAX_SAFE_INTEGER, null), false);
});

await test('with no limit and no cap nothing is checked', () => {
  assert.equal(checksNothing(noTransferLimits, noUsageCaps), true);
  assert.equal(
    checksNothing(
      { publishedTransferBytes: null, downloadBytes: 1 },
      noUsageCaps,
    ),
    false,
  );
  for (const cap of [
    'publishedTransferBytes',
    'downloadBytes',
    'objectWrites',
    'objectReads',
  ] as const)
    assert.equal(
      checksNothing(noTransferLimits, { ...noUsageCaps, [cap]: 1 }),
      false,
      cap,
    );
});

await test('the limit of the account closes its published pages and its downloads', () => {
  const state = usageState({
    limits: { publishedTransferBytes: 100, downloadBytes: 50 },
    caps: noUsageCaps,
    account: { ...zeroCounts, publishedTransferBytes: 100, downloadBytes: 49 },
    installation: {
      ...zeroCounts,
      publishedTransferBytes: 100,
      downloadBytes: 49,
    },
  });
  assert.deepEqual(state, { ...openUsage, publishedPagesClosed: true });
  const downloads = usageState({
    limits: { publishedTransferBytes: 100, downloadBytes: 50 },
    caps: noUsageCaps,
    account: { ...zeroCounts, downloadBytes: 50 },
    installation: { ...zeroCounts, downloadBytes: 50 },
  });
  assert.deepEqual(downloads, { ...openUsage, downloadsPaused: true });
});

await test('each cap of the installation closes its part for every account', () => {
  const installation = {
    publishedTransferBytes: 10,
    downloadBytes: 20,
    objectWrites: 30,
    objectReads: 40,
  };
  const caps = {
    publishedTransferBytes: 10,
    downloadBytes: 20,
    objectWrites: 30,
    objectReads: 40,
  };
  assert.deepEqual(
    usageState({
      limits: noTransferLimits,
      caps,
      account: zeroCounts,
      installation,
    }),
    {
      publishedPagesClosed: true,
      downloadsPaused: true,
      uploadsPaused: true,
      imagesPaused: true,
    },
  );
  assert.deepEqual(
    usageState({
      limits: noTransferLimits,
      caps: {
        publishedTransferBytes: 11,
        downloadBytes: 21,
        objectWrites: 31,
        objectReads: 41,
      },
      account: zeroCounts,
      installation,
    }),
    openUsage,
  );
});

await test('each gate refuses only past its own closure', () => {
  assert.equal(usageGateOf('exportWorkspace'), 'download');
  assert.equal(usageGateOf('getAttachmentRevision'), 'attachment');
  assert.equal(usageGateOf('uploadAttachment'), 'upload');
  // A small answer of the API and a sync change still answer.
  for (const free of ['getAccount', 'getChanges', 'getRevision', 'listFiles'])
    assert.equal(usageGateOf(free), null, free);

  const downloads = { ...openUsage, downloadsPaused: true };
  const images = { ...openUsage, imagesPaused: true };
  const uploads = { ...openUsage, uploadsPaused: true };
  assert.equal(gateRefusal('download', downloads), 'download_limit');
  assert.equal(gateRefusal('attachment', downloads), 'download_limit');
  assert.equal(gateRefusal('upload', downloads), null);
  assert.equal(gateRefusal('download', images), null);
  assert.equal(gateRefusal('attachment', images), 'download_limit');
  assert.equal(gateRefusal('upload', uploads), 'storage_busy');
  assert.equal(gateRefusal('download', uploads), null);
  assert.equal(
    gateRefusal('download', { ...openUsage, publishedPagesClosed: true }),
    null,
  );
});

await test('a closure holds until the first instant of the next month in UTC', () => {
  assert.equal(
    nextMonthStart(new Date('2026-10-04T12:00:00.000Z')).toISOString(),
    '2026-11-01T00:00:00.000Z',
  );
  assert.equal(
    nextMonthStart(new Date('2026-12-31T23:59:59.999Z')).toISOString(),
    '2027-01-01T00:00:00.000Z',
  );
  assert.equal(secondsToNextMonth(new Date('2026-10-31T23:59:59.000Z')), 1);
  assert.equal(secondsToNextMonth(new Date('2026-10-31T23:59:59.900Z')), 1);
  assert.equal(
    secondsToNextMonth(new Date('2026-10-01T00:00:00.000Z')),
    31 * 24 * 60 * 60,
  );
});
