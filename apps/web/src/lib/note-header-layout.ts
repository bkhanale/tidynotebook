/**
 * The layout of the note header row.
 *
 * The note name is the largest type on the screen and the header carries it
 * alone: the note saves itself and every note action lives in the command
 * palette. The rule lives here so a unit test can hold it: the name takes the
 * full width of the header at every size, so the most important text on the
 * screen is never cut.
 */

/**
 * The classes of the inline editable note name.
 *
 * The name is a title, not a form field. At rest it carries no box and no
 * border, so the screen opens on the note and not on a control. A quiet
 * underline appears under the pointer and the accent underline marks
 * keyboard focus. The transparent underline is always there, so the text
 * never moves when a state changes.
 */
export function noteTitleClassName(): string {
  return 'block w-full min-w-0 border-0 border-b-2 border-transparent bg-transparent px-2 py-1 text-2xl font-semibold text-strong outline-none motion-safe:transition-colors hover:border-edge-subtle focus:border-focus';
}
