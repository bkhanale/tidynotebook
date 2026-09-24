/**
 * The path of the daily note of one date (record 0099).
 *
 * A daily note is an ordinary note. Its path is the one fact that makes it
 * the note of a date: the folder `Daily notes` and the date in the ISO 8601
 * calendar form, so the notes of a folder sort by date under the name order.
 * A note that a person moves or renames away from that path is no longer the
 * note of its date.
 *
 * The date is a calendar date and not an instant. The device decides which
 * date today is, in its own time zone, and this module never reads a clock.
 */

/** One day of the calendar. `month` runs from 1 to 12. */
export type CalendarDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

/** The folder that holds every daily note. */
export const dailyNoteFolder = 'Daily notes';

/** The note suffix. `files/path.ts` states that every note path ends in it. */
const noteSuffix = '.md';

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
 * The year stays inside the four digits of the written form, so every date
 * that passes has one written form and one path.
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

/** The path of the daily note of one date. */
export function dailyNotePath(date: CalendarDate): string {
  return `${dailyNoteFolder}/${formatCalendarDate(date)}${noteSuffix}`;
}

/**
 * The date whose daily note this path is, or `null` for any other note.
 *
 * The answer is the inverse of `dailyNotePath`: a path in a folder below
 * `Daily notes`, a name with more text than the date, or a day that the
 * calendar does not hold is not a daily note.
 */
export function dailyNoteDate(path: string): CalendarDate | null {
  const prefix = `${dailyNoteFolder}/`;
  if (!path.startsWith(prefix) || !path.endsWith(noteSuffix)) return null;
  return parseCalendarDate(
    path.slice(prefix.length, path.length - noteSuffix.length),
  );
}
