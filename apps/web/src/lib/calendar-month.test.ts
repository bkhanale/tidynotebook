/**
 * The month grid, the day arithmetic and the keys of the calendar.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays,
  addMonths,
  dateAfterKey,
  dateOfInstant,
  dayName,
  firstDayOfLocale,
  isCalendarKey,
  monthTitle,
  monthWeeks,
  weekdayNames,
  weekdayOf,
  weekdayOrder,
  weeksInGrid,
} from './calendar-month.ts';

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

await test('a grid holds six whole weeks that start on the first day', () => {
  const weeks = monthWeeks({ year: 2026, month: 9 }, 1);
  assert.equal(weeks.length, weeksInGrid);
  for (const week of weeks) {
    assert.equal(week.length, 7);
    assert.equal(weekdayOf(week[0]?.date ?? { year: 1, month: 1, day: 1 }), 1);
  }
  // September 2026 starts on a Tuesday, so the grid starts on 31 August.
  assert.deepEqual(weeks[0]?.[0], {
    date: { year: 2026, month: 8, day: 31 },
    inMonth: false,
  });
  assert.deepEqual(weeks[0]?.[1], {
    date: { year: 2026, month: 9, day: 1 },
    inMonth: true,
  });
  const inMonth = weeks.flat().filter((cell) => cell.inMonth);
  assert.equal(inMonth.length, 30);
  assert.deepEqual(
    inMonth.map((cell) => cell.date.day),
    Array.from({ length: 30 }, (_, index) => index + 1),
  );
});

await test('a week that starts on Sunday moves the grid, not the days', () => {
  const weeks = monthWeeks({ year: 2026, month: 9 }, 7);
  assert.deepEqual(weeks[0]?.[0]?.date, { year: 2026, month: 8, day: 30 });
  assert.deepEqual(weekdayOrder(7), [7, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(weekdayOrder(1), [1, 2, 3, 4, 5, 6, 7]);
  // A month that starts on the first day of the week starts the grid.
  const february = monthWeeks({ year: 2027, month: 2 }, 1);
  assert.deepEqual(february[0]?.[0], {
    date: { year: 2027, month: 2, day: 1 },
    inMonth: true,
  });
});

await test('the keys move by a day, a week, a week end, a month and a year', () => {
  const day = { year: 2026, month: 9, day: 24 };
  assert.deepEqual(dateAfterKey(day, 'ArrowLeft', 1), { ...day, day: 23 });
  assert.deepEqual(dateAfterKey(day, 'ArrowRight', 1), { ...day, day: 25 });
  assert.deepEqual(dateAfterKey(day, 'ArrowUp', 1), { ...day, day: 17 });
  assert.deepEqual(dateAfterKey(day, 'ArrowDown', 1), {
    ...day,
    day: 1,
    month: 10,
  });
  assert.deepEqual(dateAfterKey(day, 'Home', 1), { ...day, day: 21 });
  assert.deepEqual(dateAfterKey(day, 'End', 1), { ...day, day: 27 });
  assert.deepEqual(dateAfterKey(day, 'Home', 7), { ...day, day: 20 });
  assert.deepEqual(dateAfterKey(day, 'End', 7), { ...day, day: 26 });
  assert.deepEqual(dateAfterKey(day, 'PageUp', 1), { ...day, month: 8 });
  assert.deepEqual(dateAfterKey(day, 'PageDown', 1), { ...day, month: 10 });
  assert.deepEqual(dateAfterKey(day, 'PageUp', 1, true), {
    ...day,
    year: 2025,
  });
  assert.deepEqual(dateAfterKey(day, 'PageDown', 1, true), {
    ...day,
    year: 2027,
  });
});

await test('a key never moves past the four digit years', () => {
  const first = { year: 1, month: 1, day: 1 };
  assert.deepEqual(dateAfterKey(first, 'ArrowLeft', 1), first);
  assert.deepEqual(dateAfterKey(first, 'PageUp', 1), first);
  const last = { year: 9999, month: 12, day: 31 };
  assert.deepEqual(dateAfterKey(last, 'ArrowRight', 1), last);
  assert.deepEqual(dateAfterKey(last, 'PageDown', 1, true), last);
});

await test('only the keys of the grid are calendar keys', () => {
  assert.equal(isCalendarKey('ArrowDown'), true);
  assert.equal(isCalendarKey('PageUp'), true);
  assert.equal(isCalendarKey('Enter'), false);
  assert.equal(isCalendarKey('Tab'), false);
});

await test('an instant reads as the day of this device', () => {
  assert.deepEqual(dateOfInstant(new Date(2026, 8, 24, 23, 59)), {
    year: 2026,
    month: 9,
    day: 24,
  });
  assert.deepEqual(dateOfInstant(new Date(2026, 8, 25, 0, 0)), {
    year: 2026,
    month: 9,
    day: 25,
  });
});

await test('the words of the calendar name the day in any time zone', () => {
  assert.equal(monthTitle({ year: 2026, month: 9 }, 'en-GB'), 'September 2026');
  // The short month name belongs to the ICU data of the runtime (`Sep` or
  // `Sept`), so the test reads its start and its length.
  const short = monthTitle({ year: 2026, month: 9 }, 'en-GB', 'short');
  assert.match(short, /^Sep/);
  assert.ok(short.endsWith('2026'));
  assert.ok(short.length < 'September 2026'.length);
  // The punctuation between the parts belongs to the ICU data of the
  // runtime, so the test reads the parts and not the separators.
  const name = dayName({ year: 2026, month: 9, day: 24 }, 'en-GB');
  for (const part of ['Thursday', '24', 'September', '2026'])
    assert.ok(name.includes(part), `${part} in ${name}`);
  assert.ok(name.indexOf('Thursday') < name.indexOf('September'));
  assert.deepEqual(weekdayNames(1, 'en-GB'), { narrow: 'M', long: 'Monday' });
  assert.deepEqual(weekdayNames(7, 'en-GB'), { narrow: 'S', long: 'Sunday' });
});

await test('the week of a locale starts on its first day, and Monday otherwise', () => {
  const known = firstDayOfLocale('en-US');
  // An engine without week data answers the ISO week for every locale.
  assert.ok(known === 7 || known === 1);
  assert.equal(firstDayOfLocale('de-DE'), 1);
  assert.equal(firstDayOfLocale('not a locale'), 1);
});
