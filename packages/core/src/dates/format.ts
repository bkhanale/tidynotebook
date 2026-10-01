/**
 * Date and time formats (records 0101 and 0149).
 *
 * A format is a text of tokens, the subset of moment.js that Obsidian uses,
 * for example `YYYY/MM/YYYY-MM-DD dddd`. Text inside square brackets is
 * literal, and every other character that is not a token is literal as well,
 * so a `/` in the name format of a daily note separates folders.
 *
 * | Token  | Writes                        | Token  | Writes          |
 * | ------ | ----------------------------- | ------ | --------------- |
 * | `YYYY` | the year in four digits       | `DD`   | `01` to `31`    |
 * | `YY`   | the last two digits of it     | `D`    | `1` to `31`     |
 * | `Q`    | the quarter, `1` to `4`       | `Do`   | `1st` to `31st` |
 * | `MMMM` | `January` to `December`       | `dddd` | `Monday`        |
 * | `MMM`  | `Jan` to `Dec`                | `ddd`  | `Mon`           |
 * | `MM`   | `01` to `12`                  | `dd`   | `Mo`            |
 * | `M`    | `1` to `12`                   | `d`    | `0` (Sunday) to `6` |
 *
 * The time tokens are `HH` and `H` for the hour of 24, `hh` and `h` for the
 * hour of 12, `mm` and `m` for the minute, `ss` and `s` for the second, and
 * `A` or `a` for `AM` or `am`.
 *
 * A format reads one of two vocabularies. The date vocabulary is the name
 * format of a daily note and a bare placeholder of a template: a path must
 * not change from one minute to the next, and a short word such as `had`
 * must not become a time. The date and time vocabulary is the argument of a
 * date or a time placeholder. A letter outside the vocabulary is literal, so
 * a path that holds an `H` keeps it.
 *
 * The names are English on every device, because a path that followed the
 * language of a device would give two devices two notes for one date.
 *
 * A name is read back by matching the pattern of its tokens and then writing
 * the date that it names again. The name is the name of that date only when
 * the two are equal, which holds the padding, the weekday, the ordinal and
 * the quarter in one comparison.
 */
import {
  isCalendarDate,
  weekdayOf,
  type CalendarDate,
  type Weekday,
} from './calendar.ts';
import type { ClockTime } from './clock.ts';

/** One token of the date vocabulary. */
type DateToken =
  | 'YYYY'
  | 'YY'
  | 'Q'
  | 'MMMM'
  | 'MMM'
  | 'MM'
  | 'M'
  | 'Do'
  | 'DD'
  | 'D'
  | 'dddd'
  | 'ddd'
  | 'dd'
  | 'd';

/** One token of the time of the day. */
type TimeToken = 'HH' | 'H' | 'hh' | 'h' | 'mm' | 'm' | 'ss' | 's' | 'A' | 'a';

/** One token of either vocabulary. */
type Token = DateToken | TimeToken;

/** The date tokens, longest first, so `MMMM` is never read as four `M`. */
const dateTokens: readonly DateToken[] = [
  'YYYY',
  'MMMM',
  'dddd',
  'MMM',
  'ddd',
  'YY',
  'MM',
  'Do',
  'DD',
  'dd',
  'Q',
  'M',
  'D',
  'd',
];

/** The time tokens, longest first. */
const timeTokens: readonly TimeToken[] = [
  'HH',
  'hh',
  'mm',
  'ss',
  'H',
  'h',
  'm',
  's',
  'A',
  'a',
];

/**
 * Both vocabularies, longest first. No date token starts with a time token or
 * the reverse, so the order of two tokens of one length does not matter.
 */
const dateTimeTokens: readonly Token[] = [...dateTokens, ...timeTokens].sort(
  (left, right) => right.length - left.length,
);

/** Whether a token writes a part of the time and not of the date. */
function isTimeToken(token: Token): token is TimeToken {
  return timeTokens.some((entry) => entry === token);
}

/** One part of a format: a token, or literal text. */
type Part<T extends Token> =
  | { readonly kind: 'token'; readonly token: T }
  | {
      readonly kind: 'text';
      readonly text: string;
      /** True for text that the format wrote inside square brackets. */
      readonly bracketed: boolean;
    };

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The names of the ISO weekdays, from Monday. */
const weekdayNames: Readonly<Record<Weekday, string>> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

/** Splits a format into the tokens of one vocabulary and literal text. */
function partsOf<T extends Token>(
  format: string,
  vocabulary: readonly T[],
): readonly Part<T>[] {
  const parts: Part<T>[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') parts.push({ kind: 'text', text, bracketed: false });
    text = '';
  };
  let index = 0;
  while (index < format.length) {
    if (format[index] === '[') {
      const end = format.indexOf(']', index + 1);
      if (end !== -1) {
        flush();
        const inside = format.slice(index + 1, end);
        if (inside !== '')
          parts.push({ kind: 'text', text: inside, bracketed: true });
        index = end + 1;
        continue;
      }
    }
    const token = vocabulary.find((entry) => format.startsWith(entry, index));
    if (token === undefined) {
      text += format[index] ?? '';
      index += 1;
      continue;
    }
    flush();
    parts.push({ kind: 'token', token });
    index += token.length;
  }
  flush();
  return parts;
}

/** The English ordinal of a day of the month, for example `2nd`. */
function ordinal(day: number): string {
  const tens = day % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : day % 10 === 1
        ? 'st'
        : day % 10 === 2
          ? 'nd'
          : day % 10 === 3
            ? 'rd'
            : 'th';
  return `${String(day)}${suffix}`;
}

/** The text that one date token writes for one date. */
function dateTokenText(token: DateToken, date: CalendarDate): string {
  const weekday = weekdayOf(date);
  const month = monthNames[date.month - 1] ?? '';
  switch (token) {
    case 'YYYY':
      return String(date.year).padStart(4, '0');
    case 'YY':
      return String(date.year % 100).padStart(2, '0');
    case 'Q':
      return String(Math.ceil(date.month / 3));
    case 'MMMM':
      return month;
    case 'MMM':
      return month.slice(0, 3);
    case 'MM':
      return String(date.month).padStart(2, '0');
    case 'M':
      return String(date.month);
    case 'Do':
      return ordinal(date.day);
    case 'DD':
      return String(date.day).padStart(2, '0');
    case 'D':
      return String(date.day);
    case 'dddd':
      return weekdayNames[weekday];
    case 'ddd':
      return weekdayNames[weekday].slice(0, 3);
    case 'dd':
      return weekdayNames[weekday].slice(0, 2);
    case 'd':
      return String(weekday % 7);
  }
}

/** A number in two digits, for example `07`. */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** The text that one time token writes for one time of the day. */
function timeTokenText(token: TimeToken, time: ClockTime): string {
  const hourOfTwelve = time.hour % 12 === 0 ? 12 : time.hour % 12;
  switch (token) {
    case 'HH':
      return twoDigits(time.hour);
    case 'H':
      return String(time.hour);
    case 'hh':
      return twoDigits(hourOfTwelve);
    case 'h':
      return String(hourOfTwelve);
    case 'mm':
      return twoDigits(time.minute);
    case 'm':
      return String(time.minute);
    case 'ss':
      return twoDigits(time.second);
    case 's':
      return String(time.second);
    case 'A':
      return time.hour < 12 ? 'AM' : 'PM';
    case 'a':
      return time.hour < 12 ? 'am' : 'pm';
  }
}

/** The text that a format of the date vocabulary gives one date. */
export function formatDate(date: CalendarDate, format: string): string {
  return partsOf(format, dateTokens)
    .map((part) =>
      part.kind === 'text' ? part.text : dateTokenText(part.token, date),
    )
    .join('');
}

/** The text that a format of both vocabularies gives one date and time. */
export function formatDateTime(
  date: CalendarDate,
  time: ClockTime,
  format: string,
): string {
  return partsOf(format, dateTimeTokens)
    .map((part) => {
      if (part.kind === 'text') return part.text;
      return isTimeToken(part.token)
        ? timeTokenText(part.token, time)
        : dateTokenText(part.token, date);
    })
    .join('');
}

/** The tokens that state the month and the day of the month. */
const monthTokens: readonly DateToken[] = ['MMMM', 'MMM', 'MM', 'M'];
const dayTokens: readonly DateToken[] = ['Do', 'DD', 'D'];

/** What a format lacks to name one date, or `null` when it names one. */
export type DateFormatProblem = 'no_year' | 'no_month' | 'no_day';

/**
 * Whether a format names one date.
 *
 * A format must state a year, a month and a day of the month, so two dates
 * never share a name. A weekday or a quarter alone names no date.
 */
export function dateFormatProblem(format: string): DateFormatProblem | null {
  const used = new Set(
    partsOf(format, dateTokens).flatMap((part) =>
      part.kind === 'token' ? [part.token] : [],
    ),
  );
  if (!used.has('YYYY') && !used.has('YY')) return 'no_year';
  if (!monthTokens.some((token) => used.has(token))) return 'no_month';
  if (!dayTokens.some((token) => used.has(token))) return 'no_day';
  return null;
}

/**
 * Whether a text is a format of one vocabulary and nothing else.
 *
 * It holds at least one token, and every letter outside square brackets
 * belongs to a token, so a word such as `Monday` is not read as tokens.
 */
function isFormatOf(text: string, vocabulary: readonly Token[]): boolean {
  const parts = partsOf(text, vocabulary);
  return (
    parts.some((part) => part.kind === 'token') &&
    parts.every(
      (part) =>
        part.kind === 'token' || part.bracketed || !/\p{L}/u.test(part.text),
    )
  );
}

/**
 * Whether a text is a format of date tokens alone, as a bare template
 * placeholder such as `{{YYYY-MM-DD}}` is (records 0102 and 0149).
 */
export function isDateFormat(text: string): boolean {
  return isFormatOf(text, dateTokens);
}

/**
 * Whether a text is a format of date and time tokens, as the argument of
 * `{{date:...}}` and `{{time:...}}` is (record 0149).
 */
export function isDateTimeFormat(text: string): boolean {
  return isFormatOf(text, dateTimeTokens);
}

/** Escapes one literal text for a regular expression. */
function escaped(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The pattern that one date token matches, with one capture group. */
function tokenPattern(token: DateToken): string {
  switch (token) {
    case 'YYYY':
      return '(\\d{4})';
    case 'YY':
    case 'MM':
    case 'DD':
      return '(\\d{2})';
    case 'Q':
      return '([1-4])';
    case 'M':
    case 'D':
      return '(\\d{1,2})';
    case 'Do':
      return '(\\d{1,2}(?:st|nd|rd|th))';
    case 'MMMM':
      return `(${monthNames.join('|')})`;
    case 'MMM':
      return `(${monthNames.map((name) => name.slice(0, 3)).join('|')})`;
    case 'dddd':
      return `(${Object.values(weekdayNames).join('|')})`;
    case 'ddd':
      return `(${Object.values(weekdayNames)
        .map((name) => name.slice(0, 3))
        .join('|')})`;
    case 'dd':
      return `(${Object.values(weekdayNames)
        .map((name) => name.slice(0, 2))
        .join('|')})`;
    case 'd':
      return '([0-6])';
  }
}

/**
 * The year of a two digit year, as moment.js reads it: `00` to `68` are in
 * this century and `69` to `99` in the century before.
 */
function yearOfTwoDigits(value: number): number {
  return value <= 68 ? 2000 + value : 1900 + value;
}

/**
 * The date that a name states, or `null` when it is not a name of the format.
 *
 * The date comes from the year, the month and the day tokens, and the name is
 * that date only when the format writes the same name for it again.
 */
export function parseDate(name: string, format: string): CalendarDate | null {
  if (dateFormatProblem(format) !== null) return null;
  const parts = partsOf(format, dateTokens);
  const pattern = new RegExp(
    `^${parts
      .map((part) =>
        part.kind === 'text' ? escaped(part.text) : tokenPattern(part.token),
      )
      .join('')}$`,
  );
  const match = pattern.exec(name);
  if (match === null) return null;
  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  let group = 1;
  for (const part of parts) {
    if (part.kind === 'text') continue;
    const value = match[group] ?? '';
    group += 1;
    switch (part.token) {
      case 'YYYY':
        year = Number(value);
        break;
      case 'YY':
        year ??= yearOfTwoDigits(Number(value));
        break;
      case 'MMMM':
        month = monthNames.findIndex((entry) => entry === value) + 1 || null;
        break;
      case 'MMM':
        month ??=
          monthNames.findIndex((entry) => entry.slice(0, 3) === value) + 1 ||
          null;
        break;
      case 'MM':
      case 'M':
        month ??= Number(value);
        break;
      case 'Do':
        day ??= Number.parseInt(value, 10);
        break;
      case 'DD':
      case 'D':
        day ??= Number(value);
        break;
      default:
        break;
    }
  }
  if (year === null || month === null || day === null) return null;
  const date = { year, month, day };
  if (!isCalendarDate(date)) return null;
  return formatDate(date, format) === name ? date : null;
}
