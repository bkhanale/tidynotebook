/**
 * The day arithmetic of the calendar.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays,
  addMonths,
  daysInMonth,
  formatCalendarDate,
  isCalendarDate,
  parseCalendarDate,
  sameCalendarDate,
  weekdayOf,
} from './calendar.ts';

await test('the weekday of a date follows the ISO week', () => {
  assert.equal(weekdayOf({ year: 1970, month: 1, day: 1 }), 4);
  assert.equal(weekdayOf({ year: 2026, month: 9, day: 24 }), 4);
  assert.equal(weekdayOf({ year: 2026, month: 9, day: 27 }), 7);
  assert.equal(weekdayOf({ year: 2000, month: 2, day: 29 }), 2);
  // Before the origin and in a year of fewer than four digits.
  assert.equal(weekdayOf({ year: 1969, month: 12, day: 31 }), 3);
  assert.equal(weekdayOf({ year: 1, month: 1, day: 1 }), 1);
});

await test('a day move crosses a month, a year and a leap day', () => {
  assert.deepEqual(addDays({ year: 2026, month: 9, day: 30 }, 1), {
    year: 2026,
    month: 10,
    day: 1,
  });
  assert.deepEqual(addDays({ year: 2026, month: 1, day: 1 }, -1), {
    year: 2025,
    month: 12,
    day: 31,
  });
  assert.deepEqual(addDays({ year: 2028, month: 2, day: 28 }, 1), {
    year: 2028,
    month: 2,
    day: 29,
  });
  assert.deepEqual(addDays({ year: 2026, month: 2, day: 28 }, 1), {
    year: 2026,
    month: 3,
    day: 1,
  });
  // A walk of four hundred years comes back to the same weekday.
  const start = { year: 2026, month: 9, day: 24 };
  assert.deepEqual(addDays(addDays(start, 146097), -146097), start);
  assert.equal(weekdayOf(addDays(start, 146097)), weekdayOf(start));
});

await test('a month move keeps the day, or takes the last day of a short month', () => {
  assert.deepEqual(addMonths({ year: 2026, month: 1, day: 31 }, 1), {
    year: 2026,
    month: 2,
    day: 28,
  });
  assert.deepEqual(addMonths({ year: 2026, month: 12, day: 15 }, 1), {
    year: 2027,
    month: 1,
    day: 15,
  });
  assert.deepEqual(addMonths({ year: 2026, month: 1, day: 15 }, -1), {
    year: 2025,
    month: 12,
    day: 15,
  });
  assert.deepEqual(addMonths({ year: 2028, month: 2, day: 29 }, 12), {
    year: 2029,
    month: 2,
    day: 28,
  });
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
});

await test('two dates are the same day only when every part matches', () => {
  const date = { year: 2026, month: 9, day: 24 };
  assert.equal(sameCalendarDate(date, { ...date }), true);
  assert.equal(sameCalendarDate(date, { ...date, day: 25 }), false);
  assert.equal(sameCalendarDate(date, { ...date, month: 10 }), false);
  assert.equal(sameCalendarDate(date, { ...date, year: 2027 }), false);
});
