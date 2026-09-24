/**
 * The days of the calendar, as data (records 0099 and 0101).
 *
 * A daily note names a calendar date and not an instant. The name format
 * writes the weekday of a date, and the calendar of the sidebar moves between
 * days and months, so both read the day arithmetic of this one module.
 *
 * Day arithmetic counts whole days from a fixed origin of the proleptic
 * Gregorian calendar, never through a `Date`. A `Date` reads a two digit year
 * as a year of the twentieth century and moves a local instant across a
 * change of summer time, and a calendar day has neither problem. This module
 * never reads a clock: the device decides which date today is.
 */

/** One day of the calendar. `month` runs from 1 to 12. */
export type CalendarDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

/** A day of the week in the ISO 8601 order: 1 is Monday and 7 is Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The ISO weekdays in order. */
export const weekdays: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** The written form of a date, `YYYY-MM-DD`. */
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a year is a leap year of the Gregorian calendar. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** How many days one month of one year holds. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Whether the value is a real day of the calendar.
 *
 * The year stays inside four digits, so every date that passes has one
 * written form and one path.
 */
export function isCalendarDate(date: CalendarDate): boolean {
  return (
    Number.isInteger(date.year) &&
    Number.isInteger(date.month) &&
    Number.isInteger(date.day) &&
    date.year >= 1 &&
    date.year <= 9999 &&
    date.month >= 1 &&
    date.month <= 12 &&
    date.day >= 1 &&
    date.day <= daysInMonth(date.year, date.month)
  );
}

/** Two dates are the same day. */
export function sameCalendarDate(
  left: CalendarDate,
  right: CalendarDate,
): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day
  );
}

/** The written form of a date, for example `2026-09-24`. */
export function formatCalendarDate(date: CalendarDate): string {
  return [
    String(date.year).padStart(4, '0'),
    String(date.month).padStart(2, '0'),
    String(date.day).padStart(2, '0'),
  ].join('-');
}

/** Reads the written form of a date, or `null` when it is not a real day. */
export function parseCalendarDate(text: string): CalendarDate | null {
  const match = datePattern.exec(text);
  if (match === null) return null;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return isCalendarDate(date) ? date : null;
}

/**
 * Days from 1970-01-01 to a date of the proleptic Gregorian calendar.
 *
 * This is the civil day count of Howard Hinnant, which is exact for every
 * year of the four digit form.
 */
function dayNumber(date: CalendarDate): number {
  const year = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const shifted = date.month > 2 ? date.month - 3 : date.month + 9;
  const dayOfYear = Math.floor((153 * shifted + 2) / 5) + date.day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The date of one civil day count, the inverse of `dayNumber`. */
function dateOfDayNumber(days: number): CalendarDate {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** The weekday of a date. */
export function weekdayOf(date: CalendarDate): Weekday {
  // 1970-01-01 was a Thursday, the fourth day of an ISO week.
  const index = (((dayNumber(date) + 3) % 7) + 7) % 7;
  return weekdays[index] ?? 1;
}

/** The date a number of days after another. A negative number goes back. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return dateOfDayNumber(dayNumber(date) + days);
}

/**
 * The same day a number of months later, or the last day of that month.
 *
 * The 31st of January and one month is the last day of February, which is
 * what a person means by the next month.
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}
