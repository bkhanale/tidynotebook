/**
 * The plain-words view of work that the server can no longer accept.
 *
 * A parked save is a queue entry the server refused for good. Its text is
 * kept in the account-bound recovery area, and the Needs attention screen
 * lists it. This module holds only the pure parts: it turns a stored record
 * into one row of that list, with a sentence instead of a code, a note name
 * instead of a path, and a relative time instead of a timestamp.
 *
 * The reason map is open on purpose. Another refusal code can arrive from a
 * newer server without a change here: an unknown code reads as one general
 * sentence, and the person still keeps the text.
 */
import type { NoteRefusal } from '@notesapp/core';
import type { RecoveryReason, RecoveryRecord } from '@notesapp/sync';
import { displayNoteName } from './note-name.ts';

/** The suffix a recovered copy of a note carries. */
export const recoveredSuffix = ' (recovered)';

/** One sentence for each refusal code this release knows. */
const codeSentences: Readonly<Record<string, string>> = {
  path_conflict: 'Another note already uses that name.',
  stale_head: 'The note changed on the server after this save was made.',
  deleted_remotely: 'The note was deleted on the server.',
  invalid_graph: 'This save does not fit the saved history of the note.',
  too_many_files:
    'This change moves too many notes at one time. Move the notes in smaller groups.',
  invalid_path: 'The note name is not one the server accepts.',
  invalid_content: 'The text of this save did not arrive complete.',
  mutation_reused:
    'The server already answered a different save under this identity.',
  purged: 'The note was permanently deleted.',
  quota: 'The workspace has no space left.',
  snapshot_required: 'This device must download the workspace again first.',
  unsupported_version: 'This device is too old for the server.',
  not_found: 'The server has no note to save this text into.',
  forbidden: 'The server does not allow a save of this note.',
  unrenderable_note:
    'The note has too much Markdown to show formatted. Divide a long paragraph or table, or make the note smaller.',
  // Kept by the upgrade from an earlier version of the app (record 0088).
  unplaced_work:
    'An earlier version of the app kept this text. The note changed after that, so the text does not fit it.',
};

/**
 * One sentence for each limit of the grammar that refuses a note (record
 * 0182), in the words of the answer to the commit of that note, so a cause
 * reads the same on every surface.
 */
const noteRefusalSentences: Readonly<Record<NoteRefusal, string>> = {
  note_too_large:
    'This note is too large. Move some of its text to another note.',
  note_too_deep:
    'This note nests too deeply. Remove some levels of lists, quotes or HTML.',
  note_too_many_marks:
    'A paragraph of this note has too many formatting marks. Divide the paragraph.',
  note_too_many_cells:
    'The tables of this note have too many cells. Move some rows to another note.',
};

/** The sentence of one limit of the grammar that refused a note. */
export function noteRefusalSentence(refusal: NoteRefusal): string {
  return noteRefusalSentences[refusal];
}

/** One sentence for each reason a text reached the recovery area. */
const reasonSentences: Readonly<Record<RecoveryReason, string>> = {
  purged: 'The note was permanently deleted.',
  sign_out: 'You signed out while this save waited.',
  save_refused: 'The server refused this save.',
  stale_draft:
    'This is unsaved text from an older version of the note, kept when you took the newer version.',
};

/**
 * Why one kept text needs attention, in one sentence.
 *
 * A refused save is explained by the limit of the grammar that refused its
 * note, when the record keeps one, and otherwise by its server code. A
 * record kept before a device stored that limit reads the sentence of its
 * code. A code this release does not know falls back to the general
 * sentence, so a newer refusal reason is still readable. No code, no
 * identifier, and no timestamp reach the person.
 */
export function parkedSaveReason(
  reason: RecoveryReason,
  code: string | null,
  noteRefusal: NoteRefusal | null = null,
): string {
  if (reason === 'save_refused' && noteRefusal !== null)
    return noteRefusalSentence(noteRefusal);
  if (reason === 'save_refused' && code !== null) {
    const sentence = codeSentences[code];
    if (sentence !== undefined) return sentence;
  }
  return reasonSentences[reason] ?? 'The server refused this save.';
}

/** One parked save as the Needs attention list shows it. */
export type ParkedSave = {
  readonly recoveryId: string;
  readonly fileId: string;
  /** The parked queue entry, when the record names one. */
  readonly mutationId: string | null;
  /** The note name, with no storage suffix and no identifier. */
  readonly name: string;
  /** The stored note path, used when the text becomes a new note. */
  readonly path: string;
  readonly reason: string;
  readonly text: string;
  readonly createdAt: string;
};

/** The list rows of one recovery area, newest first. */
export function parkedSaves(
  records: readonly RecoveryRecord[],
): readonly ParkedSave[] {
  return records
    .map((record) => ({
      recoveryId: record.recoveryId,
      fileId: record.fileId,
      mutationId: record.mutationId,
      name: displayNoteName(record.path),
      path: record.path,
      reason: parkedSaveReason(record.reason, record.code, record.noteRefusal),
      text: record.text,
      createdAt: record.createdAt,
    }))
    .sort((left, right) =>
      left.createdAt < right.createdAt
        ? 1
        : left.createdAt > right.createdAt
          ? -1
          : 0,
    );
}

/** How long ago something happened, in words a person reads. */
export function parkedSaveTime(createdAt: string, now: Date): string {
  const then = Date.parse(createdAt);
  if (Number.isNaN(then)) return 'at an unknown time';
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) return 'less than a minute ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return minutes === 1 ? '1 minute ago' : `${String(minutes)} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return hours === 1 ? '1 hour ago' : `${String(hours)} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? '1 day ago' : `${String(days)} days ago`;
  return 'more than a month ago';
}

/** The two lines of text of one row of the Needs attention list. */
export type ParkedSaveLines = {
  /** Why the save waits, and that the text stays on this device. */
  readonly cause: string;
  /** When the text was kept, as a relative time in its own sentence. */
  readonly kept: string;
};

/**
 * The text of one row, as separate sentences.
 *
 * The cause is one or more whole sentences, and the time is a sentence of
 * its own. A time that followed the cause in one sentence read as "The text
 * stays on this device less than a minute ago.", which states a wrong fact.
 */
export function parkedSaveLines(save: ParkedSave, now: Date): ParkedSaveLines {
  return {
    cause: `${save.reason} The text stays on this device.`,
    kept: `Kept ${parkedSaveTime(save.createdAt, now)}.`,
  };
}

/**
 * A free note name for a recovered copy.
 *
 * The name keeps the note it came from and adds the recovered suffix. When
 * that name is taken, a number follows, so a second recovery of one note
 * never writes over the first one.
 */
export function recoveredNoteName(
  name: string,
  takenPaths: readonly string[],
): string {
  const taken = new Set(takenPaths.map((path) => path.toLowerCase()));
  const base = `${name}${recoveredSuffix}`;
  if (!taken.has(`${base.toLowerCase()}.md`)) return base;
  let index = 2;
  while (taken.has(`${base.toLowerCase()} ${String(index)}.md`)) index += 1;
  return `${base} ${String(index)}`;
}
