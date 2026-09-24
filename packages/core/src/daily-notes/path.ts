/**
 * The path of the daily note of one date (records 0099 and 0101).
 *
 * A daily note is an ordinary note. Its path is the one fact that makes it
 * the note of a date: the folder of the settings, then the name that the name
 * format gives the date, then the note suffix. A `/` in the format makes
 * folders below the folder. A note that a person moves or renames away from
 * that path is no longer the note of its date.
 */
import { normalizePath } from '../files/path.ts';
import type { CalendarDate } from './calendar.ts';
import {
  dailyNoteFormatProblem,
  formatDailyNoteName,
  parseDailyNoteName,
} from './format.ts';

/** Where the daily notes of a member live and how each one is named. */
export type DailyNoteLayout = {
  /** A folder path, or an empty text for the top of the workspace. */
  readonly folder: string;
  /** The name format, as the tokens of `format.ts`. */
  readonly format: string;
};

/** The layout of record 0099, which a member starts with. */
export const defaultDailyNoteLayout: DailyNoteLayout = {
  folder: 'Daily notes',
  format: 'YYYY-MM-DD',
};

/** The note suffix. `files/path.ts` states that every note path ends in it. */
const noteSuffix = '.md';

/**
 * Dates whose names hold the longest words of a format.
 *
 * September and Wednesday are the longest names of a month and of a weekday,
 * and the 30th is a two digit day, so a format whose name of these dates
 * passes the path rules passes them for every date: a token writes letters
 * and digits alone, and the rest of the name does not change with the date.
 */
const sampleDates: readonly CalendarDate[] = [
  { year: 2026, month: 9, day: 30 },
  { year: 2026, month: 1, day: 1 },
];

/** The path of the daily note of one date. */
export function dailyNotePath(
  date: CalendarDate,
  layout: DailyNoteLayout,
): string {
  const name = `${formatDailyNoteName(date, layout.format)}${noteSuffix}`;
  return layout.folder === '' ? name : `${layout.folder}/${name}`;
}

/**
 * The date whose daily note this path is, or `null` for any other note.
 *
 * The answer is the inverse of `dailyNotePath`: a path outside the folder, a
 * name that the format does not write, or a day that the calendar does not
 * hold is not a daily note.
 */
export function dailyNoteDate(
  path: string,
  layout: DailyNoteLayout,
): CalendarDate | null {
  const prefix = layout.folder === '' ? '' : `${layout.folder}/`;
  if (!path.startsWith(prefix) || !path.endsWith(noteSuffix)) return null;
  return parseDailyNoteName(
    path.slice(prefix.length, path.length - noteSuffix.length),
    layout.format,
  );
}

/** Why a layout cannot name the daily notes, or `null` when it can. */
export type DailyNoteLayoutProblem =
  'folder' | 'no_year' | 'no_month' | 'no_day' | 'path';

/**
 * Whether a layout gives every date one valid note path.
 *
 * The folder must pass the folder rules of `files/path.ts` in its stored
 * spelling, the format must name one date, and the path of every date must
 * pass the note rules with no empty part and no space at the end of a part.
 */
export function dailyNoteLayoutProblem(
  layout: DailyNoteLayout,
): DailyNoteLayoutProblem | null {
  if (layout.folder !== '') {
    const folder = normalizePath(layout.folder, 'folder');
    if (!folder.ok || folder.value !== layout.folder) return 'folder';
  }
  const format = dailyNoteFormatProblem(layout.format);
  if (format !== null) return format;
  for (const date of sampleDates) {
    // Each part of the name is a name that a person could type: not empty,
    // and no space at either end, which the note name field refuses too.
    const name = formatDailyNoteName(date, layout.format);
    if (name.split('/').some((part) => part === '' || part !== part.trim()))
      return 'path';
    const path = dailyNotePath(date, layout);
    const normalized = normalizePath(path);
    if (!normalized.ok || normalized.value !== path) return 'path';
  }
  return null;
}

/**
 * The stored spelling of a folder that a person typed.
 *
 * Space at the ends and a slash at either end are dropped, so ` Journal/ `
 * is the folder `Journal`, and an empty result is the top of the workspace.
 */
export function cleanDailyNoteFolder(text: string): string {
  return text
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .trim();
}
