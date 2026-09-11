/**
 * The layout of the note header row.
 *
 * The note name is the largest type on the screen and the row also carries
 * the save action, the Write and Read toggle, and one overflow menu. The rule
 * lives here so a unit test can hold it: on a phone the name takes a line of
 * its own and the actions wrap under it. A name that shares the line with the
 * actions is cut after a few letters, and the most important text on the
 * screen becomes unreadable.
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
  return 'min-w-0 grow basis-full border-0 border-b-2 border-transparent bg-transparent px-2 py-1 text-2xl font-semibold text-strong outline-none motion-safe:transition-colors hover:border-edge-subtle focus:border-focus sm:basis-0';
}
