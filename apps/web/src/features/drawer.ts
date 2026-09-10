/**
 * The presentation of the navigation drawer.
 *
 * Below `md` the drawer is an overlay that slides in over the content. From
 * `md` up it is a fixed part of the frame. The rule lives here so a unit test
 * can hold it: a closed overlay must leave the tab order and the
 * accessibility tree, not only move off the screen.
 */

/** The classes of the navigation drawer in its open or closed state. */
export function drawerClassName(open: boolean): string {
  const base =
    'fixed bottom-0 left-0 top-header z-40 flex w-64 flex-col border-r border-edge-subtle bg-surface text-muted motion-safe:transition-transform md:visible md:translate-x-0';
  // `invisible` and not only `-translate-x-full`: a panel that stays visible
  // keeps every link inside it reachable by keyboard and by a screen reader,
  // so the person would walk into a drawer that is not on the screen.
  const state = open ? 'translate-x-0' : '-translate-x-full max-md:invisible';
  return `${base} ${state}`;
}
