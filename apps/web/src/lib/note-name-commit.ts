/**
 * What happens to the name a person typed into the name field.
 *
 * The field is a place to write, not a live rename. A keystroke changes the
 * words in the field and nothing else, so a half-typed name never reaches the
 * tree, the store, or another device. The name is kept when the person
 * presses Enter or leaves the field, and Enter then moves the caret into the
 * note. Escape gives the field back the name the note has.
 *
 * A live rename wrote each step of the typing. A step that matched the name
 * of another note, such as the original of a duplicate, showed a refusal
 * while the person was still typing.
 *
 * The rules live here, outside JSX, so a unit test can read them.
 */
import {
  baseNameOf,
  cleanNoteBaseName,
  displayNoteName,
  duplicateNameProblem,
  joinNotePath,
  noteBaseNameProblem,
  noteNameProblem,
  storageNotePath,
} from './note-name.ts';

/** The outcome of one commit of the name field. */
export type NoteNameCommit =
  /** The note keeps its path, and the field shows this name. */
  | { readonly kind: 'unchanged'; readonly name: string }
  /** The note takes this path, and the field shows this name. */
  | { readonly kind: 'rename'; readonly path: string; readonly name: string }
  /** The name is refused for this reason, and the note keeps its path. */
  | { readonly kind: 'refused'; readonly problem: string };

/** Decides what one commit of the typed name does. */
export function commitNoteName(input: {
  readonly typed: string;
  readonly folder: string;
  readonly currentPath: string;
  readonly notes: readonly { readonly fileId: string; readonly path: string }[];
  readonly fileId: string;
}): NoteNameCommit {
  const base = cleanNoteBaseName(input.typed);
  const problem =
    noteBaseNameProblem(base) ??
    noteNameProblem(joinNotePath(input.folder, base));
  if (problem !== null) return { kind: 'refused', problem };
  const path = joinNotePath(input.folder, storageNotePath(base));
  const name = displayNoteName(baseNameOf(path));
  if (path === input.currentPath) return { kind: 'unchanged', name };
  const clash = duplicateNameProblem(path, input.notes, input.fileId);
  if (clash !== null) return { kind: 'refused', problem: clash };
  return { kind: 'rename', path, name };
}

/** What one key in the name field does. */
export type NoteNameKey = 'commit' | 'revert' | null;

/**
 * The action of one key in the name field.
 *
 * Enter keeps the name and moves on to the note. Escape gives up the typed
 * words. A key inside an IME composition belongs to the composition.
 */
export function noteNameKey(key: string, composing: boolean): NoteNameKey {
  if (composing) return null;
  if (key === 'Enter') return 'commit';
  if (key === 'Escape') return 'revert';
  return null;
}

/**
 * Whether the name of the open note is still newer than the store after a
 * draft write.
 *
 * A draft write states the path the note had when the write started. The
 * name can move while the write runs, for example to the name of a heading
 * at a version (record 0163). The store then holds the older path, and the
 * editor must not adopt it from the next queue read.
 */
export function nameStillPending(
  savedPath: string,
  current: { readonly current: string },
): boolean {
  return current.current !== savedPath;
}
