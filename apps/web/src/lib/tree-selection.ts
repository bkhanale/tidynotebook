/**
 * The selection of many rows of the tree (record 0164).
 *
 * The tree marks the open note and the folder that a create action uses
 * (records 0029 and 0034). A selection of many rows is a third thing: a set
 * that a person builds on purpose with Ctrl or Cmd and a click, Shift and a
 * click, Shift and an arrow, Space, or Ctrl or Cmd and A. A plain click or
 * Enter clears it, and does what it did before. While the set is empty, an
 * action acts on the row it starts from.
 *
 * The rules are pure, so `tree-selection.test.ts` states each one. A key is
 * the key of a row in `tree-rows.ts`, and `order` is the list of the keys of
 * the rows a person can act on, in the order of the screen.
 */

/** The rows a person picked, and the row a range starts from. */
export type TreeSelection = {
  readonly keys: ReadonlySet<string>;
  /** The row that Shift extends from, or `null` before any pick. */
  readonly anchor: string | null;
};

/** No row picked. */
export const emptySelection: TreeSelection = { keys: new Set(), anchor: null };

/** Adds a row to the selection, or takes it out when it is in it. */
export function toggleRow(
  selection: TreeSelection,
  key: string,
  current: string | null = null,
): TreeSelection {
  const keys = new Set(selection.keys);
  // The first pick of a set adds the row the person stood on as well, so
  // Ctrl and a click on a second note selects two notes and not one.
  if (keys.size === 0 && current !== null && current !== key) keys.add(current);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { keys, anchor: key };
}

/**
 * Selects every row from the anchor to `key`, in the order of the screen.
 *
 * With no anchor the range starts at `from`, which is the row that had the
 * focus, so Shift and an arrow from a row with no selection selects both
 * rows.
 */
export function selectRange(
  selection: TreeSelection,
  order: readonly string[],
  key: string,
  from: string | null,
): TreeSelection {
  const anchor =
    selection.anchor !== null && order.includes(selection.anchor)
      ? selection.anchor
      : (from ?? key);
  const start = order.indexOf(anchor);
  const end = order.indexOf(key);
  if (start === -1 || end === -1) return selection;
  const [low, high] = start <= end ? [start, end] : [end, start];
  return { keys: new Set(order.slice(low, high + 1)), anchor };
}

/** Selects every row a person can see. */
export function selectAll(order: readonly string[]): TreeSelection {
  return { keys: new Set(order), anchor: order[0] ?? null };
}

/**
 * Keeps the rows that are still on the screen.
 *
 * A folder that closes hides the rows inside it, and an action that moved a
 * note to Trash removes its row. A row that is gone cannot be acted on, so it
 * leaves the set, and an anchor that is gone leaves with it.
 */
export function keepVisible(
  selection: TreeSelection,
  order: readonly string[],
): TreeSelection {
  const visible = new Set(order);
  const kept = [...selection.keys].filter((key) => visible.has(key));
  const anchor =
    selection.anchor !== null && visible.has(selection.anchor)
      ? selection.anchor
      : null;
  if (kept.length === selection.keys.size && anchor === selection.anchor)
    return selection;
  return { keys: new Set(kept), anchor };
}

/**
 * The rows that an action started from one row acts on, in screen order.
 *
 * A row in a selection of several rows acts for the whole set. Any other row
 * acts for itself alone, so a right click on a row outside the set does not
 * reach the rows of the set.
 */
export function actionTargets(
  selection: TreeSelection,
  order: readonly string[],
  key: string,
): readonly string[] {
  if (!selection.keys.has(key)) return [key];
  return order.filter((entry) => selection.keys.has(entry));
}

/** Whether a row reads as selected. */
export function isRowSelected(selection: TreeSelection, key: string): boolean {
  return selection.keys.has(key);
}
