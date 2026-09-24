/**
 * What the daily notes of a workspace are on this device (record 0099).
 *
 * A daily note is the note at the dated path of `@notesapp/core`, so every
 * rule here reads the note list that the frame already holds: which note is
 * the note of a date, which days of a month have one, which note is the
 * template, and whether the note of today opens at start. The settings live
 * on the server, and this device keeps the last answer in browser settings
 * for a start with no connection, which is why the parse of that copy is here
 * too. Everything is pure, so the rules are tested without a browser.
 */
import {
  dailyNoteDate,
  dailyNotePath,
  type CalendarDate,
  type DailyNoteLayout,
  type DailyNoteLayoutProblem,
  type DailyNoteSettings,
} from '@notesapp/core';
import type { CalendarMonth } from './calendar-month.ts';
import { baseNameOf, displayNoteName, folderOf } from './note-name.ts';

/** The facts of a note that these rules read. */
export type DailyNoteCandidate = {
  readonly fileId: string;
  readonly path: string;
};

/** The note of one date, or `null` when the workspace holds none. */
export function dailyNoteOf(
  notes: readonly DailyNoteCandidate[],
  date: CalendarDate,
  layout: DailyNoteLayout,
): string | null {
  const path = dailyNotePath(date, layout);
  return notes.find((note) => note.path === path)?.fileId ?? null;
}

/** The days of one month that hold a daily note. */
export function daysWithNotes(
  notes: readonly DailyNoteCandidate[],
  month: CalendarMonth,
  layout: DailyNoteLayout,
): ReadonlySet<number> {
  const days = new Set<number>();
  for (const note of notes) {
    const date = dailyNoteDate(note.path, layout);
    if (date !== null && date.year === month.year && date.month === month.month)
      days.add(date.day);
  }
  return days;
}

/**
 * The template that a new daily note takes now, or `null` for none.
 *
 * The stored template counts only while it is a live note of the list. A
 * template in Trash reads as no template until a restore brings it back, and
 * the stored reference stays.
 */
export function effectiveTemplateId(
  settings: DailyNoteSettings,
  notes: readonly DailyNoteCandidate[],
): string | null {
  const id = settings.templateFileId;
  return id !== null && notes.some((note) => note.fileId === id) ? id : null;
}

/** One choice of the template field, the shape a select option takes. */
export type TemplateChoice = {
  readonly value: string;
  readonly label: string;
};

/** The value of the template choice that names no template. */
export const noTemplateValue = '';

/**
 * The choices of the template field: no template, then every note.
 *
 * A note reads by its name, and by its folder when it has one, the way the
 * note list names it to a screen reader. The notes sort by that label, so a
 * person finds a name where they expect it.
 */
export function templateChoices(
  notes: readonly DailyNoteCandidate[],
): readonly TemplateChoice[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  const rows = notes
    .map((note) => {
      const name = displayNoteName(baseNameOf(note.path));
      const folder = folderOf(note.path);
      return {
        value: note.fileId,
        label: folder === '' ? name : `${name}, in ${folder}`,
      };
    })
    .sort((left, right) => collator.compare(left.label, right.label));
  return [{ value: noTemplateValue, label: 'No template' }, ...rows];
}

/** The template that one value of the template field names. */
export function templateOfChoice(value: string): string | null {
  return value === noTemplateValue ? null : value;
}

/**
 * Whether the note of today opens now, at the start of the application.
 *
 * It opens once for each load, when the setting is on, when the first page of
 * the frame was the note list, and when the person has not moved since. An
 * address of a note or of another page opens what it names.
 */
export function opensTodayAtStart(input: {
  readonly openOnStart: boolean;
  readonly startedOnNoteList: boolean;
  readonly stillOnStart: boolean;
}): boolean {
  return input.openOnStart && input.startedOnNoteList && input.stillOnStart;
}

/** The browser settings key of whether the sidebar shows the month. */
export const calendarOpenStorageKey = 'notesapp.calendar-open';

/**
 * Whether the sidebar shows the month, from the stored value.
 *
 * The month shows by default (record 0100), so only the stored word for a
 * hidden month hides it and any other value shows it.
 */
export function parseCalendarOpen(stored: string | null): boolean {
  return stored !== 'hidden';
}

/** The stored value of one choice. */
export function formatCalendarOpen(open: boolean): string {
  return open ? 'shown' : 'hidden';
}

/** The browser settings key of the cached settings of one member. */
export function dailyNoteSettingsKey(
  accountId: string,
  workspaceId: string,
): string {
  return `notesapp.daily-notes:${accountId}:${workspaceId}`;
}

/** The text that this device keeps for one answer of the server. */
export function formatCachedSettings(settings: DailyNoteSettings): string {
  return JSON.stringify({
    templateFileId: settings.templateFileId,
    openOnStart: settings.openOnStart,
    folder: settings.folder,
    format: settings.format,
  });
}

/**
 * The settings of a cached copy, or `null` when the copy does not parse.
 *
 * Another page of this origin can write the same key, so every member is
 * checked and a copy of another shape is no copy at all.
 */
export function parseCachedSettings(
  source: string | null,
): DailyNoteSettings | null {
  if (source === null || source === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null;
  const row: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  const templateFileId = row['templateFileId'];
  const openOnStart = row['openOnStart'];
  const folder = row['folder'];
  const format = row['format'];
  if (typeof openOnStart !== 'boolean') return null;
  if (templateFileId !== null && typeof templateFileId !== 'string')
    return null;
  // A copy from before record 0101 holds no layout, and a layout that the
  // server would not store is no copy of an answer.
  if (typeof folder !== 'string' || typeof format !== 'string') return null;
  return { templateFileId, openOnStart, folder, format };
}

/**
 * What a person reads when a daily note does not open, one sentence for one
 * cause. Each one states what happened and what to do next.
 */
export const dailyNoteProblems = {
  storage: 'Local storage is unavailable, so the daily note cannot open.',
  settings:
    'The daily note settings did not load, so the note was not made. Connect to the internet and try again.',
  template:
    'The template is not on this device, so the note was not made. Connect to the internet and try again.',
  quota:
    'This device is full, so the note was not made. Free space and try again.',
  write: 'The note could not be made on this device.',
  templateRefused: 'That note cannot be the template. Choose another note.',
  offline:
    'The setting did not reach the server. Try again when you are online.',
} as const;

/**
 * What a person reads when a change of a setting did not reach the server.
 *
 * The server answers `not_found` for a template that is no live note of the
 * workspace, and no answer at all means the setting is not kept. Each of the
 * two has its own sentence. Every other failure takes the one sentence of the
 * problem that the caller already chose.
 */
export function settingsProblem(status: number, general: string): string {
  if (status === 404) return dailyNoteProblems.templateRefused;
  // With no answer at all the setting is not kept anywhere, which the
  // general sentence of an unreachable server does not say.
  if (status === 0) return dailyNoteProblems.offline;
  return general;
}

/**
 * What a person reads when a folder or a name format cannot name every date,
 * one sentence for each cause.
 */
export const layoutProblemSentences: Readonly<
  Record<DailyNoteLayoutProblem, string>
> = {
  folder: 'That folder name cannot be stored. Change the name and try again.',
  no_year: 'Add a year to the format, for example YYYY.',
  no_month: 'Add a month to the format, for example MM.',
  no_day: 'Add a day to the format, for example DD.',
  path: 'That format makes a name that cannot be stored. Remove the empty folder or the space at the end.',
};

/**
 * The name of the note of one date as the layout writes it, for the preview
 * under the settings. The storage suffix stays hidden (record 0099).
 */
export function dailyNotePreview(
  date: CalendarDate,
  layout: DailyNoteLayout,
): string {
  return displayNoteName(dailyNotePath(date, layout));
}
