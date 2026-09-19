/** Pure layout choices shared by the page primitives. */

/** How the actions below a page title use their row. */
export type PageHeaderActionLayout = 'cluster' | 'split';

/** The layout of the action area of a page header. */
export function pageHeaderActionsClassName(
  layout: PageHeaderActionLayout,
): string {
  return layout === 'split'
    ? 'flex w-full items-center justify-between gap-group'
    : 'flex shrink-0 items-center gap-cluster';
}
