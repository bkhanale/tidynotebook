/**
 * One row of the note list, as data.
 *
 * The list on the note screen shows three facts about a note: its name, the
 * folder that holds it, and how long ago it changed. The time is relative,
 * the same way the sidebar, the footer, the trash, and the history state it,
 * so one note reads the same wherever it appears. This function is pure and
 * takes the current instant, so a test states both ends.
 */
import { baseNameOf, displayNoteName, folderOf } from './note-name.ts';
import { relativeTime } from './relative-time.ts';

/** The three facts a note row shows. */
export type NoteRowMeta = {
  /** The note name, without its folder and without the `.md` suffix. */
  readonly name: string;
  /** The folder that holds the note, or `null` at the top. */
  readonly folder: string | null;
  /** How long ago the note changed, in words. */
  readonly when: string;
};

/** The facts a note row shows, from a stored path and its change instant. */
export function noteRowMeta(
  path: string,
  updatedAt: string,
  now: number,
): NoteRowMeta {
  const folder = folderOf(path);
  return {
    name: displayNoteName(baseNameOf(path)),
    folder: folder === '' ? null : folder,
    when: relativeTime(updatedAt, now),
  };
}
