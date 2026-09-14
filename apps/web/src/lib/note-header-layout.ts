/**
 * The layout of the note header row.
 *
 * The note name is the largest type on the screen and the header carries it
 * alone: the note saves itself and every note action lives in the command
 * palette. The rule lives here so a unit test can hold it: the name takes the
 * full width of the header at every size, so the most important text on the
 * screen is never cut.
 *
 * The name and the text of the note are one block, so the space under the
 * name stays small. The space above it keeps the row clear of the frame.
 */

/**
 * The classes of the sticky header row.
 *
 * The bottom space is smaller than the top space on purpose: the name titles
 * the text under it, so the two group together and the note reads as one
 * page. The editor column and the note surface add the rest of the space, so
 * this row keeps its own part of it short.
 */
export function noteHeaderRowClassName(): string {
  return 'sticky top-0 z-20 flex shrink-0 flex-col gap-1 border-b border-edge-subtle bg-app px-4 pb-1.5 pt-3 sm:px-6';
}

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
