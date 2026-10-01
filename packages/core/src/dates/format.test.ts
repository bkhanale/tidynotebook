/**
 * The date and time formats, and the parse of a date.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from './calendar.ts';
import {
  dateFormatProblem,
  formatDate,
  formatDateTime,
  isDateFormat,
  isDateTimeFormat,
  parseDate,
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
    assert.equal(formatDate(day, format), written, format);
  assert.equal(
    formatDate({ year: 2026, month: 1, day: 4 }, 'M/D DD'),
    '1/4 04',
  );
  // Sunday is 0, as moment.js writes it.
  assert.equal(
    formatDate({ year: 2026, month: 9, day: 27 }, 'd'),
    '0',
  );
});

await test('a slash makes folders and brackets keep text as it is', () => {
  assert.equal(
    formatDate(day, 'YYYY/MM/YYYY-MM-DD dddd'),
    '2026/09/2026-09-25 Friday',
  );
  assert.equal(
    formatDate(day, '[Journal] YYYY-MM-DD'),
    'Journal 2026-09-25',
  );
  // An unbracketed letter of a token is that token, as in moment.js.
  assert.equal(formatDate(day, 'Day YYYY'), '25ay 2026');
  // A bracket that never closes is text.
  assert.equal(formatDate(day, '[YYYY'), '[2026');
});

await test('the ordinal follows English, eleven to thirteen included', () => {
  const ordinals = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map((value) =>
    formatDate({ year: 2026, month: 1, day: value }, 'Do'),
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
  assert.equal(dateFormatProblem('YYYY-MM-DD'), null);
  assert.equal(dateFormatProblem('YY MMM Do'), null);
  assert.equal(dateFormatProblem('MM-DD'), 'no_year');
  assert.equal(dateFormatProblem('YYYY-DD'), 'no_month');
  assert.equal(dateFormatProblem('YYYY-MM dddd'), 'no_day');
  // A token inside brackets is text and names nothing.
  assert.equal(dateFormatProblem('[YYYY]-MM-DD'), 'no_year');
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
      const name = formatDate(date, format);
      assert.deepEqual(
        parseDate(name, format),
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
    assert.equal(parseDate(name, format), null, name);
  // A format that names no date reads no date at all.
  assert.equal(parseDate('09-25', 'MM-DD'), null);
  // Padding is part of the name.
  assert.equal(parseDate('2026-9-5', 'YYYY-MM-DD'), null);
  assert.deepEqual(parseDate('2026-9-5', 'YYYY-M-D'), {
    year: 2026,
    month: 9,
    day: 5,
  });
  // A two digit year reads as moment.js reads it.
  assert.deepEqual(parseDate('68-01-01', 'YY-MM-DD'), {
    year: 2068,
    month: 1,
    day: 1,
  });
  assert.deepEqual(parseDate('69-01-01', 'YY-MM-DD'), {
    year: 1969,
    month: 1,
    day: 1,
  });
  // Text that a regular expression reads as syntax stays text.
  assert.deepEqual(parseDate('(2026).09.25', '(YYYY).MM.DD'), day);
  assert.equal(parseDate('(2026)x09x25', '(YYYY).MM.DD'), null);
});

/** 14:05:09 in the afternoon. */
const afternoon = { hour: 14, minute: 5, second: 9 };

await test('each time token writes its part of the time', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['HH', '14'],
    ['H', '14'],
    ['hh', '02'],
    ['h', '2'],
    ['mm', '05'],
    ['m', '5'],
    ['ss', '09'],
    ['s', '9'],
    ['A', 'PM'],
    ['a', 'pm'],
  ];
  for (const [format, written] of cases)
    assert.equal(formatDateTime(day, afternoon, format), written, format);
  assert.equal(
    formatDateTime(day, afternoon, 'dddd D MMMM YYYY [at] h:mm A'),
    'Friday 25 September 2026 at 2:05 PM',
  );
});

await test('midnight and noon are twelve on a clock of twelve hours', () => {
  const midnight = { hour: 0, minute: 0, second: 0 };
  const noon = { hour: 12, minute: 30, second: 0 };
  assert.equal(formatDateTime(day, midnight, 'HH:mm h A'), '00:00 12 AM');
  assert.equal(formatDateTime(day, noon, 'HH:mm hh a'), '12:30 12 pm');
});

await test('a date format reads no time token, so a path keeps its letters', () => {
  // The name format of a daily note must not change from one minute to the
  // next, so a time letter in it stays text (record 0149).
  assert.equal(formatDate(day, 'YYYY-MM-DD HH'), '2026-09-25 HH');
  assert.equal(formatDate(day, 'YYYY [at] Hamburg'), '2026 at Hamburg');
  assert.equal(isDateFormat('HH:mm'), false);
  assert.equal(isDateFormat('YYYY-MM-DD'), true);
});

await test('a date and time format holds tokens of both vocabularies', () => {
  assert.equal(isDateTimeFormat('HH:mm'), true);
  assert.equal(isDateTimeFormat('YYYY-MM-DD HH:mm:ss'), true);
  assert.equal(isDateTimeFormat('h:mm a'), true);
  assert.equal(isDateTimeFormat('[at] HH'), true);
  assert.equal(isDateTimeFormat('hello'), false);
  assert.equal(isDateTimeFormat('Monday'), false);
  assert.equal(isDateTimeFormat(''), false);
  assert.equal(isDateTimeFormat(': -'), false);
});
