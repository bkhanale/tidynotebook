/** Browser policy for the note name field. */
export type NoteNameInputPolicy = {
  readonly autoComplete: 'off';
};

/**
 * The note name is application content, not saved personal data.
 *
 * The explicit autocomplete value stops a keyboard from treating the field
 * as a contact name or another stored form value.
 */
export function noteNameInputPolicy(): NoteNameInputPolicy {
  return { autoComplete: 'off' };
}

/**
 * Whether a new note takes the focus as it opens.
 *
 * The caret goes into the text of a new note, where its first heading names
 * it (record 0163). A coarse touch screen needs the native tap to open its
 * keyboard, so it waits for that tap.
 */
export function shouldFocusNewNoteOnOpen(coarseTouch: boolean): boolean {
  return !coarseTouch;
}
