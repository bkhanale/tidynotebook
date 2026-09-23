/**
 * Where a menu draws the hairline between two groups of rows.
 *
 * A row can name a group. Rows of one group sit together, and a hairline
 * separates one group from the next, so a menu of alternatives that come in
 * sets, such as the orders of the Sort notes menu, reads as sets. A row with
 * no group is a group of its own, so a menu that names no group draws no line.
 *
 * `menu.tsx` is JSX, so no unit test can load it. The rule lives here and
 * `menu-groups.test.ts` holds it.
 */

/** Tells whether the row at `index` starts a group after an earlier one. */
export function startsGroup(
  items: readonly { readonly group?: string | undefined }[],
  index: number,
): boolean {
  if (index <= 0 || index >= items.length) return false;
  const group = items[index]?.group;
  const previous = items[index - 1]?.group;
  if (group === undefined && previous === undefined) return false;
  return group !== previous;
}
