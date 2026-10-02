/**
 * The words and the time of a copy action (record 0174).
 *
 * A code block of the editor and of a published page copies its code with one
 * control. Both read the words here, so the action has one name on every
 * surface, and the confirmation stays on the screen for one time.
 */

/** The words of the copy action of a code block. */
export const copyCodeWords = {
  /** The visible word of the control. */
  action: 'Copy',
  /** The accessible name, which starts with the visible word (WCAG 2.5.3). */
  name: 'Copy code',
  /** The word that confirms the copy. */
  done: 'Copied',
  /** What a person hears after the copy. */
  announcement: 'The code is on the clipboard.',
} as const;

/** How long a copy control states that it copied, in milliseconds. */
export const copiedForMs = 2000;
