/**
 * The rows of the note menu, in the order a person reads them.
 *
 * The note route puts one control in the frame header, and that control is
 * this menu (decision 0069). History and Publish are rows of it, so the
 * header never spends a button of its own on either one and a phone keeps
 * that width for the name of the note.
 *
 * The order groups the rows by what they act on. History and Publish read and
 * share the note as it stands. Rename, Move to folder and Duplicate change
 * the note as a file. Attach an image and Export as Markdown carry content in
 * and out. Move to Trash destroys, so it is not in this list: it is the
 * pinned row under the separator, away from the row a person reaches for by
 * mistake.
 *
 * Each row names a glyph of `lib/palette-items.ts`, so the menu, the palette
 * and the sidebar cannot show three marks for one action (decision 0065).
 *
 * The move to Trash has one name on every surface: the note menu, a row of
 * the tree, a folder row, a selection and the command palette (issue 245).
 * In Trash, Delete removes a note for good, so a move to Trash never reads
 * Delete. This module is the one place that writes those words, and
 * `note-menu.test.ts` refuses any other source that draws the glyph of the
 * move or writes a Delete label for it.
 *
 * This module is pure, so a unit test holds the order and the rows.
 */
import type { ActionIconName } from './palette-items.ts';

/**
 * What one row of the note menu can run.
 *
 * `move-to-trash` is in the list because it is a row of the menu, and it is
 * not in {@link noteMenuRows} because it is the pinned row below the
 * separator.
 */
export type NoteMenuAction =
  | 'history'
  | 'publish'
  | 'rename'
  | 'move'
  | 'duplicate'
  | 'attach-image'
  | 'export'
  | 'move-to-trash';

/** One row of the note menu, before a screen gives it a glyph and a handler. */
export type NoteMenuRow = {
  readonly id: NoteMenuAction;
  readonly label: string;
  readonly icon: ActionIconName;
};

/** Which of the rows the open note offers right now. */
export type NoteMenuOffer = {
  /** False when the screen holds no Move to folder dialog. */
  readonly canMove: boolean;
  /** False when the screen holds no Publish dialog. */
  readonly canPublish: boolean;
};

/** Every row of the note menu, in order. */
const allRows: readonly NoteMenuRow[] = [
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'publish', label: 'Publish', icon: 'publish' },
  { id: 'rename', label: 'Rename', icon: 'rename' },
  { id: 'move', label: 'Move to folder', icon: 'move' },
  { id: 'duplicate', label: 'Duplicate', icon: 'duplicate' },
  { id: 'attach-image', label: 'Attach an image', icon: 'image' },
  { id: 'export', label: 'Export as Markdown', icon: 'export' },
];

/** The one name of the action that moves a note or a folder to Trash. */
export const moveToTrashLabel = 'Move to Trash';

/** The same action as a row of the command palette, which names its object. */
export const moveNoteToTrashPaletteLabel = 'Move this note to Trash';

/** The pinned row that moves the note to Trash. */
export const noteTrashRow: NoteMenuRow = {
  id: 'move-to-trash',
  label: moveToTrashLabel,
  icon: 'move-to-trash',
};

/**
 * The rows the note menu shows for one open note.
 *
 * A row whose dialog the screen does not hold is absent, because a row that
 * does nothing is worse than no row at all.
 */
export function noteMenuRows(offer: NoteMenuOffer): readonly NoteMenuRow[] {
  return allRows.filter(
    (row) =>
      (row.id !== 'move' || offer.canMove) &&
      (row.id !== 'publish' || offer.canPublish),
  );
}
