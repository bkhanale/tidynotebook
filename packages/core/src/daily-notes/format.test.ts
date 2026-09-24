/**
 * The name format of a daily note, and its parse.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from './calendar.ts';
import {
  dailyNoteFormatProblem,
  formatDailyNoteName,
  parseDailyNoteName,
} from './format.ts';

/** Friday, 25 September 2026. */
const day = { year: 2026, month: 9, day: 25 };

await test('each token writes its part of the date', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['YYYY', '2026'],
    ['YY', '26'],
    ['Q', '3'],
    ['MMMM', 'September'],
    ['MMM', 'Sep'],
    ['MM', '09'],
    ['M', '9'],
    ['DD', '25'],
    ['D', '25'],
    ['Do', '25th'],
    ['dddd', 'Friday'],
    ['ddd', 'Fri'],
    ['dd', 'Fr'],
    ['d', '5'],
  ];
  for (const [format, written] of cases)
    assert.equal(formatDailyNoteName(day, format), written, format);
  assert.equal(
    formatDailyNoteName({ year: 2026, month: 1, day: 4 }, 'M/D DD'),
    '1/4 04',
  );
  // Sunday is 0, as moment.js writes it.
  assert.equal(
    formatDailyNoteName({ year: 2026, month: 9, day: 27 }, 'd'),
    '0',
  );
});

await test('a slash makes folders and brackets keep text as it is', () => {
  assert.equal(
    formatDailyNoteName(day, 'YYYY/MM/YYYY-MM-DD dddd'),
    '2026/09/2026-09-25 Friday',
  );
  assert.equal(
    formatDailyNoteName(day, '[Journal] YYYY-MM-DD'),
    'Journal 2026-09-25',
  );
  // An unbracketed letter of a token is that token, as in moment.js.
  assert.equal(formatDailyNoteName(day, 'Day YYYY'), '25ay 2026');
  // A bracket that never closes is text.
  assert.equal(formatDailyNoteName(day, '[YYYY'), '[2026');
});

await test('the ordinal follows English, eleven to thirteen included', () => {
  const ordinals = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map((value) =>
    formatDailyNoteName({ year: 2026, month: 1, day: value }, 'Do'),
  );
  assert.deepEqual(ordinals, [
    '1st',
    '2nd',
    '3rd',
    '4th',
    '11th',
    '12th',
    '13th',
    '21st',
    '22nd',
    '23rd',
    '31st',
  ]);
});

await test('a format must name a year, a month and a day', () => {
  assert.equal(dailyNoteFormatProblem('YYYY-MM-DD'), null);
  assert.equal(dailyNoteFormatProblem('YY MMM Do'), null);
  assert.equal(dailyNoteFormatProblem('MM-DD'), 'no_year');
  assert.equal(dailyNoteFormatProblem('YYYY-DD'), 'no_month');
  assert.equal(dailyNoteFormatProblem('YYYY-MM dddd'), 'no_day');
  // A token inside brackets is text and names nothing.
  assert.equal(dailyNoteFormatProblem('[YYYY]-MM-DD'), 'no_year');
});

await test('a name reads back as the date that writes it', () => {
  const formats = [
    'YYYY-MM-DD',
    'YYYY/MM/YYYY-MM-DD dddd',
    'YYYY/MMMM/Do',
    '[Journal] ddd, D MMM YY',
    'YYYY/[Q]Q/M-D',
    'YYYYMMDD',
    'dd d DD.MM.YYYY',
  ];
  let date = { year: 2025, month: 12, day: 20 };
  for (let step = 0; step < 400; step += 1) {
    for (const format of formats) {
      const name = formatDailyNoteName(date, format);
      assert.deepEqual(
        parseDailyNoteName(name, format),
        date,
        `${format} ${name}`,
      );
    }
    date = addDays(date, 1);
  }
});

await test('a name the format does not write names no date', () => {
  const format = 'YYYY/MM/YYYY-MM-DD dddd';
  for (const name of [
    '2026/09/2026-09-25 Thursday',
    '2026/09/2026-09-25',
    '2026/10/2026-09-25 Friday',
    '2026/09/2026-9-25 Friday',
    '2026/09/2026-09-31 Thursday',
    '2026/09/2026-09-25 friday',
    'Plans',
  ])
    assert.equal(parseDailyNoteName(name, format), null, name);
  // A format that names no date reads no date at all.
  assert.equal(parseDailyNoteName('09-25', 'MM-DD'), null);
  // Padding is part of the name.
  assert.equal(parseDailyNoteName('2026-9-5', 'YYYY-MM-DD'), null);
  assert.deepEqual(parseDailyNoteName('2026-9-5', 'YYYY-M-D'), {
    year: 2026,
    month: 9,
    day: 5,
  });
  // A two digit year reads as moment.js reads it.
  assert.deepEqual(parseDailyNoteName('68-01-01', 'YY-MM-DD'), {
    year: 2068,
    month: 1,
    day: 1,
  });
  assert.deepEqual(parseDailyNoteName('69-01-01', 'YY-MM-DD'), {
    year: 1969,
    month: 1,
    day: 1,
  });
  // Text that a regular expression reads as syntax stays text.
  assert.deepEqual(parseDailyNoteName('(2026).09.25', '(YYYY).MM.DD'), day);
  assert.equal(parseDailyNoteName('(2026)x09x25', '(YYYY).MM.DD'), null);
});
