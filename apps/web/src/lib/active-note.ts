/**
 * What the panels around one open note know about its editor.
 *
 * The outline needs the live buffer and a caret position, not the last saved
 * text. The note screen owns the one editor view of the open working copy and
 * the scope in `features/editor/active-note.tsx` holds this value for the note
 * that is open. The transitions and the caret rule stay here, so a test proves
 * them without React and without an editor.
 */

/** The editor of the open note, and a count of the changes of its text. */
export type ActiveNote<View> = {
  /** The view of the open note, or null while no editor registered one. */
  readonly view: View | null;
  /**
   * Counts the registrations and the text changes of the open note.
   *
   * A panel reads the live buffer through the view, so the view alone never
   * tells the panel that the text moved on. This count changes on each such
   * event, so a panel that holds it reads the buffer again.
   */
  readonly revision: number;
};

/**
 * The value of a note screen that just opened.
 *
 * Each call gives a new value with no view and no history, so one note screen
 * never starts with what the screen before it left behind.
 */
export function emptyActiveNote<View>(): ActiveNote<View> {
  return { view: null, revision: 0 };
}

/** The value after an editor opens, or after it closes with `null`. */
export function withActiveNoteView<View>(
  note: ActiveNote<View>,
  view: View | null,
): ActiveNote<View> {
  return { view, revision: note.revision + 1 };
}

/**
 * The value after the text of the open note changed.
 *
 * Without an open editor there is no buffer to read again, so the value stays
 * as it is and no panel does work for a note that is not there.
 */
export function withActiveNoteChange<View>(
  note: ActiveNote<View>,
): ActiveNote<View> {
  return note.view === null
    ? note
    : { view: note.view, revision: note.revision + 1 };
}

/** The caret position that stays inside a document of `length` characters. */
export function activeNoteAnchor(position: number, length: number): number {
  return Math.min(Math.max(position, 0), length);
}
