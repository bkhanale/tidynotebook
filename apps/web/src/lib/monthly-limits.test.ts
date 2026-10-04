import assert from 'node:assert/strict';
import test from 'node:test';
import {
  monthEndText,
  monthNotices,
  openMonth,
  transferLines,
} from './monthly-limits.ts';
import { hasProblemSentence, problemSentence } from './problem-text.ts';

const october = openMonth(new Date('2026-10-04T10:00:00.000Z'));

await test('an account that nothing stopped has no notice', () => {
  assert.deepEqual(october, {
    month: '2026-10',
    endsAt: '2026-11-01T00:00:00.000Z',
    publishedTransferBytes: 0,
    downloadBytes: 0,
    publishedPagesClosed: false,
    downloadsPaused: false,
    uploadsPaused: false,
    imagesPaused: false,
  });
  assert.deepEqual(monthNotices(october, 'en-GB'), []);
});

await test('each closure has one notice with its cause and the date it ends', () => {
  const states = [
    'downloadsPaused',
    'uploadsPaused',
    'imagesPaused',
    'publishedPagesClosed',
  ] as const;
  const notices = states.map((state) => {
    const found = monthNotices({ ...october, [state]: true }, 'en-GB');
    assert.equal(found.length, 1, state);
    return found[0] ?? '';
  });
  for (const notice of notices) {
    assert.match(notice, /1 November 2026/);
    // No code, no identifier and no raw instant reaches the person.
    assert.doesNotMatch(notice, /_|2026-11-01|T00/);
    assert.doesNotMatch(notice, /[–—]/);
  }
  assert.equal(new Set(notices).size, notices.length);
  assert.match(notices[0] ?? '', /download limit/);
  assert.match(notices[1] ?? '', /New images and imports/);
  assert.match(notices[2] ?? '', /Images do not load/);
  assert.match(notices[3] ?? '', /published pages show a closed page/);
  assert.equal(
    monthNotices(
      {
        ...october,
        downloadsPaused: true,
        uploadsPaused: true,
        imagesPaused: true,
        publishedPagesClosed: true,
      },
      'en-GB',
    ).length,
    4,
  );
});

await test('the end of a month is a plain date in UTC', () => {
  assert.equal(
    monthEndText('2027-01-01T00:00:00.000Z', 'en-GB'),
    '1 January 2027',
  );
  assert.equal(monthEndText('not a date', 'en-GB'), 'the next month');
});

await test('a transfer line shows only for a limit that the account has', () => {
  const month = {
    ...october,
    publishedTransferBytes: 1536,
    downloadBytes: 0,
  };
  assert.deepEqual(
    transferLines(month, {
      publishedTransferLimitBytes: null,
      downloadLimitBytes: null,
    }),
    [],
  );
  assert.deepEqual(
    transferLines(month, {
      publishedTransferLimitBytes: 1024 * 1024,
      downloadLimitBytes: 2048,
    }),
    [
      'This month: 1.5 KB of 1 MB sent by published pages',
      'This month: 0 bytes of 2 KB downloaded',
    ],
  );
});

await test('the refusals of a month have a sentence of their own', () => {
  for (const code of ['download_limit', 'storage_busy']) {
    assert.equal(hasProblemSentence(code), true, code);
    assert.doesNotMatch(problemSentence(code, 429), /_/);
  }
});
