/**
 * One month of the calendar of the sidebar, as data (records 0099 and 0100).
 *
 * The calendar shows the days of one month in weeks, moves between months, and
 * moves the selected day with the keys of a date grid. Every rule of that is
 * here, as a pure function of calendar dates, so the grid, the moves and the
 * words are tested without a browser. The component in
 * `features/daily-notes/calendar.tsx` draws what these functions decide.
 *
 * The day arithmetic belongs to `@notesapp/core`, because the name format of
 * a daily note writes the weekday of a date with the same count (record
 * 0101). This module adds what the grid needs on top of it.
 */
import {
  addDays,
  addMonths,
  isCalendarDate,
  sameCalendarDate,
  weekdayOf,
  weekdays,
  type CalendarDate,
  type Weekday,
} from '@notesapp/core';

/** One month of one year. `month` runs from 1 to 12. */
export type CalendarMonth = {
  readonly year: number;
  readonly month: number;
};

/** One cell of the grid of a month. */
export type CalendarCell = {
  readonly date: CalendarDate;
  /** False for a day of the month before or after, which fills a week. */
  readonly inMonth: boolean;
};

/** How many weeks a grid shows, so the grid keeps one height every month. */
export const weeksInGrid = 6;

/** The weekday that starts a week when the locale states none. */
export const defaultFirstDay: Weekday = 1;

/** The month that holds a date. */
export function monthOf(date: CalendarDate): CalendarMonth {
  return { year: date.year, month: date.month };
}

/** The date of an instant in the calendar of this device. */
export function dateOfInstant(instant: Date): CalendarDate {
  return {
    year: instant.getFullYear(),
    month: instant.getMonth() + 1,
    day: instant.getDate(),
  };
}

/** The weekdays of one week, starting on `firstDay`. */
export function weekdayOrder(firstDay: Weekday): readonly Weekday[] {
  return weekdays.map(
    (_, offset) => weekdays[(firstDay - 1 + offset) % 7] ?? 1,
  );
}

/**
 * The weeks of one month, each of seven cells.
 *
 * The first week starts on `firstDay` on or before the first of the month,
 * and the grid always holds `weeksInGrid` weeks, so the page does not change
 * its height from one month to the next.
 */
export function monthWeeks(
  month: CalendarMonth,
  firstDay: Weekday,
): readonly (readonly CalendarCell[])[] {
  const first: CalendarDate = { ...month, day: 1 };
  const lead = (weekdayOf(first) - firstDay + 7) % 7;
  const start = addDays(first, -lead);
  const weeks: CalendarCell[][] = [];
  for (let week = 0; week < weeksInGrid; week += 1) {
    const cells: CalendarCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(start, week * 7 + day);
      cells.push({
        date,
        inMonth: date.year === month.year && date.month === month.month,
      });
    }
    weeks.push(cells);
  }
  return weeks;
}

/** A key that moves the selected day of the grid. */
export const calendarKeys = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
] as const;

/** One key of {@link calendarKeys}. */
export type CalendarKey = (typeof calendarKeys)[number];

/** Whether a key name is one that moves the selected day. */
export function isCalendarKey(key: string): key is CalendarKey {
  return calendarKeys.some((entry) => entry === key);
}

/**
 * The day that one key moves the selection to, as the date grid pattern of
 * WAI-ARIA states it.
 *
 * An arrow moves one day or one week, Home and End move to the first and the
 * last day of the week, and Page Up and Page Down move one month. Shift with
 * Page Up or Page Down moves one year. A move past the four digit years
 * answers the day it started from.
 */
export function dateAfterKey(
  date: CalendarDate,
  key: CalendarKey,
  firstDay: Weekday,
  shift = false,
): CalendarDate {
  const offset = (weekdayOf(date) - firstDay + 7) % 7;
  const next =
    key === 'ArrowLeft'
      ? addDays(date, -1)
      : key === 'ArrowRight'
        ? addDays(date, 1)
        : key === 'ArrowUp'
          ? addDays(date, -7)
          : key === 'ArrowDown'
            ? addDays(date, 7)
            : key === 'Home'
              ? addDays(date, -offset)
              : key === 'End'
                ? addDays(date, 6 - offset)
                : addMonths(
                    date,
                    (key === 'PageUp' ? -1 : 1) * (shift ? 12 : 1),
                  );
  return isCalendarDate(next) ? next : date;
}

/** Whether a cell is the given day. */
export function isCellOf(cell: CalendarCell, date: CalendarDate): boolean {
  return sameCalendarDate(cell.date, date);
}

/** A `Date` at noon in universal time, which names a day in any time zone. */
function instantOfDate(date: CalendarDate): Date {
  const instant = new Date(0);
  instant.setUTCFullYear(date.year, date.month - 1, date.day);
  instant.setUTCHours(12, 0, 0, 0);
  return instant;
}

/**
 * The title of a month, for example `September 2026`, or `Sep 2026` in the
 * short form that the title row of the sidebar has room for.
 */
export function monthTitle(
  month: CalendarMonth,
  locale?: string,
  length: 'long' | 'short' = 'long',
): string {
  return new Intl.DateTimeFormat(locale, {
    month: length,
    year: 'numeric',
    timeZone: 'UTC',
  }).format(instantOfDate({ ...month, day: 1 }));
}

/** The whole name of a day, which a screen reader reads for its cell. */
export function dayName(date: CalendarDate, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(instantOfDate(date));
}

/**
 * The narrow and the whole name of a weekday, for the head of a column.
 *
 * A column of the sidebar calendar is as narrow as one letter, so the head
 * shows the narrow name and states the whole one to a screen reader.
 */
export function weekdayNames(
  weekday: Weekday,
  locale?: string,
): { readonly narrow: string; readonly long: string } {
  // 2024-01-01 was a Monday, so the day of that week names each weekday.
  const date: CalendarDate = { year: 2024, month: 1, day: weekday };
  const format = (style: 'narrow' | 'long'): string =>
    new Intl.DateTimeFormat(locale, {
      weekday: style,
      timeZone: 'UTC',
    }).format(instantOfDate(date));
  return { narrow: format('narrow'), long: format('long') };
}

/**
 * The first day of the week in a locale, or Monday when it states none.
 *
 * `Intl.Locale` gives the week of a region through `getWeekInfo` in some
 * engines and through `weekInfo` in others, and an engine may give neither.
 * The value is read with a guard, so an engine without it takes the ISO week.
 */
export function firstDayOfLocale(locale: string | undefined): Weekday {
  let value: unknown;
  try {
    const known = new Intl.Locale(locale ?? navigatorLocale());
    const reader: unknown = Reflect.get(known, 'getWeekInfo');
    const info: unknown =
      typeof reader === 'function'
        ? Reflect.apply(reader, known, [])
        : Reflect.get(known, 'weekInfo');
    value =
      info !== null && typeof info === 'object'
        ? Reflect.get(info, 'firstDay')
        : undefined;
  } catch {
    return defaultFirstDay;
  }
  return weekdays.find((day) => day === value) ?? defaultFirstDay;
}

/** The language of this runtime, which `Intl` also takes by default. */
function navigatorLocale(): string {
  return new Intl.DateTimeFormat().resolvedOptions().locale;
}
