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

/** The classes of the inline editable note name. */
export function noteTitleClassName(): string {
  return 'min-w-0 grow basis-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold text-strong outline-none motion-safe:transition-colors hover:border-edge-subtle hover:bg-hover focus:border-focus focus:bg-app focus:ring-2 focus:ring-focus/25 sm:basis-0';
}
