/**
 * The path rule of a daily note, its inverse and the layout check.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePath } from '../files/path.ts';
import {
  dailyNoteDate,
  dailyNoteLayoutProblem,
  dailyNotePath,
  defaultDailyNoteLayout,
} from './path.ts';

await test('the default path is the folder and the ISO date', () => {
  assert.equal(
    dailyNotePath({ year: 2026, month: 9, day: 4 }, defaultDailyNoteLayout),
    'Daily notes/2026-09-04.md',
  );
  assert.equal(
    dailyNotePath({ year: 987, month: 12, day: 31 }, defaultDailyNoteLayout),
    'Daily notes/0987-12-31.md',
  );
});

await test('a format with a slash makes folders below the folder', () => {
  const layout = { folder: 'Journal', format: 'YYYY/MM/YYYY-MM-DD dddd' };
  const path = dailyNotePath({ year: 2026, month: 9, day: 25 }, layout);
  assert.equal(path, 'Journal/2026/09/2026-09-25 Friday.md');
  assert.deepEqual(dailyNoteDate(path, layout), {
    year: 2026,
    month: 9,
    day: 25,
  });
  // The top of the workspace is an empty folder.
  const top = { folder: '', format: 'YYYY-MM-DD' };
  assert.equal(
    dailyNotePath({ year: 2026, month: 9, day: 25 }, top),
    '2026-09-25.md',
  );
  assert.deepEqual(dailyNoteDate('2026-09-25.md', top), {
    year: 2026,
    month: 9,
    day: 25,
  });
});

await test('the path of a date is a valid note path', () => {
  const path = dailyNotePath(
    { year: 2026, month: 1, day: 1 },
    defaultDailyNoteLayout,
  );
  const normalized = normalizePath(path);
  assert.ok(normalized.ok);
  assert.equal(normalized.value, path);
});

await test('any other note is not the note of a date', () => {
  for (const path of [
    'Daily notes/Plan.md',
    'Daily notes/2026-09-24 plan.md',
    'Daily notes/Old/2026-09-24.md',
    'daily notes/2026-09-24.md',
    'Work/2026-09-24.md',
    '2026-09-24.md',
    'Daily notes/2026-09-24.txt',
    'Daily notes/2026-9-24.md',
    'Daily notes/2026-02-30.md',
  ])
    assert.equal(dailyNoteDate(path, defaultDailyNoteLayout), null, path);
});

await test('a layout names every date with one valid path', () => {
  assert.equal(dailyNoteLayoutProblem(defaultDailyNoteLayout), null);
  assert.equal(
    dailyNoteLayoutProblem({ folder: '', format: 'YYYY/MM/DD' }),
    null,
  );
  assert.equal(
    dailyNoteLayoutProblem({ folder: 'Journal', format: 'MM-DD' }),
    'no_year',
  );
  assert.equal(
    dailyNoteLayoutProblem({ folder: 'Journal', format: 'YYYY-DD' }),
    'no_month',
  );
  assert.equal(
    dailyNoteLayoutProblem({ folder: 'Journal', format: 'YYYY-MM' }),
    'no_day',
  );
  // A folder in a spelling the store does not keep.
  for (const folder of ['/Journal', 'Journal/', ' Journal', 'a//b'])
    assert.equal(
      dailyNoteLayoutProblem({ folder, format: 'YYYY-MM-DD' }),
      'folder',
      folder,
    );
  // A format whose path breaks the path rules.
  for (const format of [
    '/YYYY-MM-DD',
    'YYYY//MM-DD',
    'YYYY-MM-DD ',
    'YYYY/ /MM-DD',
  ])
    assert.equal(
      dailyNoteLayoutProblem({ folder: 'Journal', format }),
      'path',
      format,
    );
});
