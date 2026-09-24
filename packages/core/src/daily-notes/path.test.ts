/**
 * The path rule of a daily note, and its inverse.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePath } from '../files/path.ts';
import {
  dailyNoteDate,
  dailyNotePath,
  daysInMonth,
  formatCalendarDate,
  isCalendarDate,
  parseCalendarDate,
  sameCalendarDate,
} from './path.ts';

await test('the note of a date sits in the daily folder under its ISO date', () => {
  assert.equal(
    dailyNotePath({ year: 2026, month: 9, day: 4 }),
    'Daily notes/2026-09-04.md',
  );
  assert.equal(
    dailyNotePath({ year: 987, month: 12, day: 31 }),
    'Daily notes/0987-12-31.md',
  );
});

await test('the path of a date is a valid note path', () => {
  const path = dailyNotePath({ year: 2026, month: 1, day: 1 });
  const normalized = normalizePath(path);
  assert.ok(normalized.ok);
  assert.equal(normalized.value, path);
});

await test('the date of a daily note path is the inverse of its path', () => {
  const date = { year: 2028, month: 2, day: 29 };
  assert.deepEqual(dailyNoteDate(dailyNotePath(date)), date);
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
    assert.equal(dailyNoteDate(path), null, path);
});

await test('a month holds the days of the Gregorian calendar', () => {
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
});

await test('a date that the calendar does not hold is refused', () => {
  assert.equal(isCalendarDate({ year: 2026, month: 9, day: 30 }), true);
  assert.equal(isCalendarDate({ year: 2026, month: 9, day: 31 }), false);
  assert.equal(isCalendarDate({ year: 2026, month: 13, day: 1 }), false);
  assert.equal(isCalendarDate({ year: 2026, month: 0, day: 1 }), false);
  assert.equal(isCalendarDate({ year: 0, month: 1, day: 1 }), false);
  assert.equal(isCalendarDate({ year: 10000, month: 1, day: 1 }), false);
  assert.equal(isCalendarDate({ year: 2026, month: 1.5, day: 1 }), false);
});

await test('the written form of a date reads back as the same date', () => {
  const date = { year: 2026, month: 9, day: 24 };
  assert.equal(formatCalendarDate(date), '2026-09-24');
  assert.deepEqual(parseCalendarDate('2026-09-24'), date);
  assert.equal(parseCalendarDate('2026-09-31'), null);
  assert.equal(parseCalendarDate('26-09-24'), null);
  assert.equal(parseCalendarDate(' 2026-09-24'), null);
});

await test('two dates are the same day only when every part matches', () => {
  const date = { year: 2026, month: 9, day: 24 };
  assert.equal(sameCalendarDate(date, { ...date }), true);
  assert.equal(sameCalendarDate(date, { ...date, day: 25 }), false);
  assert.equal(sameCalendarDate(date, { ...date, month: 10 }), false);
  assert.equal(sameCalendarDate(date, { ...date, year: 2027 }), false);
});
