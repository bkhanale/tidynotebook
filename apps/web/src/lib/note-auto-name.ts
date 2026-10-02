/**
 * The name that a new note takes from its first heading (record 0163).
 *
 * A new note was named New note, New note 2 and so on, and it kept that name
 * when its first line was a heading (issue 252). The name of a note now
 * follows its first line when that line is a heading, while the name is
 * automatic: the placeholder of a new note, or the name the heading gave,
 * with the number that kept it free in its folder. Any other name is the
 * choice of a person, and the heading does not move it. No flag is stored:
 * the name itself carries the fact, so the rule holds on every device and
 * with no connection.
 *
 * The open editor applies the rule at the boundary of a version, so one
 * version holds the new heading and the new name. A rename is a path change,
 * and the server rewrites every portable link to the note when it accepts
 * the version (record 0037).
 *
 * The functions are pure, so `note-auto-name.test.ts` states every rule. The
 * heading is read with the one grammar of `@notesapp/editor`.
 */
import {
  dailyNoteDate,
  defaultDailyNoteLayout,
  type DailyNoteLayout,
} from '@notesapp/core';
import { previewStructureOf } from '@notesapp/editor';
import { freeNamedPath } from './new-note-draft.ts';
import {
  baseNameOf,
  displayNoteName,
  folderOf,
  noteBaseNameProblem,
} from './note-name.ts';

/** The most characters a name from a heading takes. */
export const maxHeadingNameLength = 60;

/** The most bytes that one stored segment of a path holds. */
const maxStoredBytes = 255;

/** The placeholder of a new note, with or without its number. */
const placeholder = /^New note(?: [2-9]\d*| 1\d+)?$/u;

/** C0, delete and C1 controls, format characters, and line separators. */
const hiddenCharacter = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * The first block of a note: its text up to the first blank line after the
 * first line that holds text, at most a few thousand characters.
 *
 * The rule reads only the first line, so the editor parses this block and
 * not the whole note at each version.
 */
export function firstBlockOf(text: string): string {
  const lines = text.slice(0, 4000).split('\n');
  const start = lines.findIndex((line) => line.trim() !== '');
  if (start === -1) return '';
  const rest = lines.slice(start);
  const end = rest.findIndex((line, index) => index > 0 && line.trim() === '');
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * The note name that one heading gives, or `null` when it gives none.
 *
 * A slash and a backslash become a hyphen, because a name holds no folder.
 * A hidden character goes, white space folds to one space, and a long
 * heading is cut at a word within {@link maxHeadingNameLength} characters.
 */
export function nameFromHeading(heading: string): string | null {
  let name = heading
    .replace(hiddenCharacter, ' ')
    .replace(/[/\\]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
  // The cut counts what a person reads as one character, so it never splits
  // an emoji or a letter with its accent.
  const graphemes = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name),
    (part) => part.segment,
  );
  // A stored name is at most 255 bytes with its suffix, and a character
  // outside ASCII takes up to four of them, so the cut also stops there.
  const encoder = new TextEncoder();
  let kept = Math.min(graphemes.length, maxHeadingNameLength);
  while (
    kept > 0 &&
    encoder.encode(`${graphemes.slice(0, kept).join('')}.md`).length >
      maxStoredBytes
  )
    kept -= 1;
  if (kept < graphemes.length) {
    const cut = graphemes.slice(0, kept).join('');
    const space = cut.lastIndexOf(' ');
    name = (space > kept / 2 ? cut.slice(0, space) : cut).trim();
  }
  // A name that ends in the storage suffix would lose it as a name.
  name = displayNoteName(name).trim();
  if (name === '' || noteBaseNameProblem(name) !== null) return null;
  return name;
}

/** Whether a name is the placeholder of a new note. */
export function isPlaceholderName(name: string): boolean {
  return placeholder.test(name);
}

/** Whether a name is the heading name, or the heading name with a number. */
function isNameOf(name: string, heading: string): boolean {
  const lower = name.toLowerCase();
  const base = heading.toLowerCase();
  if (lower === base) return true;
  if (!lower.startsWith(`${base} `)) return false;
  return /^[2-9]\d*$|^1\d+$/u.test(lower.slice(base.length + 1));
}

/**
 * Whether the name of a note follows its heading.
 *
 * `heading` is the name that the heading gave when the editor last read the
 * name: when it opened the note, or when it renamed it. A name a person chose
 * is neither the placeholder nor that name, so it stops the rule.
 */
export function followsHeading(name: string, heading: string | null): boolean {
  if (isPlaceholderName(name)) return true;
  return heading !== null && isNameOf(name, heading);
}

/**
 * The path a note takes at a version, or `null` when it keeps its path.
 *
 * The note keeps its folder. The name is the heading name, or the first free
 * one with a number after it, as New note takes. A note whose name already
 * is the heading name, with or without a number, keeps it, so a free name
 * that opens up later does not move the note again.
 */
export function automaticPath(input: {
  readonly currentPath: string;
  /** The heading name the editor last read, or `null`. */
  readonly lastHeading: string | null;
  /** The name the heading gives now, or `null` when it gives none. */
  readonly heading: string | null;
  readonly notes: readonly { readonly fileId: string; readonly path: string }[];
  readonly fileId: string;
}): string | null {
  const heading = input.heading;
  if (heading === null) return null;
  const name = displayNoteName(baseNameOf(input.currentPath));
  if (!followsHeading(name, input.lastHeading)) return null;
  if (isNameOf(name, heading)) return null;
  const taken = input.notes
    .filter((note) => note.fileId !== input.fileId)
    .map((note) => note.path);
  return freeNamedPath(taken, folderOf(input.currentPath), heading);
}

/**
 * The name that the first line of a text gives, when that line is a heading.
 * The one grammar reads the first block alone, so a version of a long note
 * does not parse the whole note for its name.
 */
export function headingNameOf(text: string): string | null {
  const first = previewStructureOf(firstBlockOf(text))[0];
  return first?.kind === 'heading' ? nameFromHeading(first.text) : null;
}

/**
 * The layout that guards a daily note from the rule (record 0099).
 *
 * A daily note keeps the name of its date. The settings of the member say
 * where daily notes live, and a fresh device with no connection has no
 * answer yet. The rule must still hold with no connection (record 0163), so
 * the default layout guards a note until the settings answer: a note at a
 * path of the default layout keeps its name, and every other note follows
 * its heading.
 */
export function dailyGuardLayout(
  settings: DailyNoteLayout | null,
): DailyNoteLayout {
  return settings ?? defaultDailyNoteLayout;
}

/** What one boundary of a version reads for the name of the open note. */
export type HeadingStepInput = {
  readonly path: string;
  readonly text: string;
  /** The heading name the editor last read, or `null`. */
  readonly lastHeading: string | null;
  /** The daily note layout of the member, or `null` before it answers. */
  readonly dailyLayout: DailyNoteLayout | null;
  /** The name field holds words that a person is typing. */
  readonly typing: boolean;
  /**
   * A person wrote in the note since its last version. A note that only
   * opened writes no version (record 0133), so its heading renames nothing.
   */
  readonly edited: boolean;
  readonly notes: readonly { readonly fileId: string; readonly path: string }[];
  readonly fileId: string;
};

/** The outcome of one boundary: a new path or none, and the heading read. */
export type HeadingStep = {
  readonly path: string | null;
  readonly lastHeading: string | null;
};

/**
 * Decides at one boundary of a version whether the open note takes the name
 * of its heading. A name a person is typing, a note with no input since its
 * last version and a daily note keep their name.
 */
export function headingStep(input: HeadingStepInput): HeadingStep {
  const keep = { path: null, lastHeading: input.lastHeading };
  if (input.typing || !input.edited) return keep;
  if (dailyNoteDate(input.path, dailyGuardLayout(input.dailyLayout)) !== null)
    return keep;
  const heading = headingNameOf(input.text);
  const path = automaticPath({
    currentPath: input.path,
    lastHeading: input.lastHeading,
    heading,
    notes: input.notes,
    fileId: input.fileId,
  });
  return path === null ? keep : { path, lastHeading: heading };
}
