/**
 * What a key does to the tree, from the row that has the focus (record
 * 0164).
 *
 * `tree-keys.ts` turns a key press into an intent. This module turns an
 * intent and the row it starts from into one action of the tree, so the
 * screen performs the action and holds no rule. The row is the row of the
 * element that has the focus, read from the document, and not a remembered
 * key: a click on the chevron or the action button of a row moves the
 * focus without telling the tree.
 *
 * The rules are pure, so `tree-navigation.test.ts` states each path.
 */
import type { TreeKeyIntent } from './tree-keys.ts';
import type { ActionableRow, TreeRowEntry } from './tree-rows.ts';

/** One action of the tree that a key asks for. */
export type TreeKeyAction =
  | { readonly kind: 'focus'; readonly key: string }
  | { readonly kind: 'extend'; readonly to: string; readonly from: string }
  | { readonly kind: 'toggle-folder'; readonly path: string }
  | { readonly kind: 'open-note'; readonly fileId: string }
  | { readonly kind: 'select-folder'; readonly path: string }
  | { readonly kind: 'toggle-select'; readonly key: string }
  | { readonly kind: 'select-all' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'rename'; readonly key: string }
  | { readonly kind: 'menu'; readonly key: string }
  | { readonly kind: 'trash'; readonly key: string }
  | { readonly kind: 'none' };

/** What the rule reads about the tree. */
export type TreeKeyContext = {
  readonly rows: readonly TreeRowEntry[];
  /** The keys of the rows a person can act on, in screen order. */
  readonly order: readonly string[];
  /** The row of the element that has the focus. */
  readonly key: string;
  /** Some row is in the selection. */
  readonly selecting: boolean;
};

/** The action of one intent, from the row that has the focus. */
export function treeKeyAction(
  intent: TreeKeyIntent,
  context: TreeKeyContext,
): TreeKeyAction {
  const { rows, order, key } = context;
  const at = order.indexOf(key);
  if (at === -1) return { kind: 'none' };
  const index = rows.findIndex((row) => row.key === key);
  const row = rows[index];
  if (row === undefined || row.kind === 'empty') return { kind: 'none' };
  const step = (delta: number): string | undefined => order[at + delta];
  switch (intent) {
    case 'next':
    case 'previous': {
      const next = step(intent === 'next' ? 1 : -1);
      return next === undefined
        ? { kind: 'none' }
        : { kind: 'focus', key: next };
    }
    case 'extend-next':
    case 'extend-previous': {
      const next = step(intent === 'extend-next' ? 1 : -1);
      return next === undefined
        ? { kind: 'none' }
        : { kind: 'extend', to: next, from: key };
    }
    case 'first':
    case 'last': {
      const next = intent === 'first' ? order[0] : order.at(-1);
      return next === undefined || next === key
        ? { kind: 'none' }
        : { kind: 'focus', key: next };
    }
    case 'expand': {
      if (row.kind !== 'folder') return { kind: 'none' };
      if (!row.expanded) return { kind: 'toggle-folder', path: row.path };
      const child = rows[index + 1];
      return child !== undefined &&
        child.kind !== 'empty' &&
        child.parentKey === key
        ? { kind: 'focus', key: child.key }
        : { kind: 'none' };
    }
    case 'collapse':
      if (row.kind === 'folder' && row.expanded)
        return { kind: 'toggle-folder', path: row.path };
      return row.parentKey === null
        ? { kind: 'none' }
        : { kind: 'focus', key: row.parentKey };
    case 'activate':
      return activate(row);
    case 'toggle-select':
      return { kind: 'toggle-select', key };
    case 'select-all':
      return { kind: 'select-all' };
    case 'clear':
      return context.selecting ? { kind: 'clear' } : { kind: 'none' };
    case 'rename':
      return { kind: 'rename', key };
    case 'menu':
      return { kind: 'menu', key };
    case 'trash':
      return { kind: 'trash', key };
  }
}

/** What Enter does on one row. */
function activate(row: ActionableRow): TreeKeyAction {
  return row.kind === 'note'
    ? { kind: 'open-note', fileId: row.note.fileId }
    : { kind: 'select-folder', path: row.path };
}

/**
 * The row that takes the focus after some rows left the tree, such as a move
 * to Trash from the keys: the first row after the last row that left, else
 * the last row before the first one, else no row.
 */
export function focusAfterRemoval(
  order: readonly string[],
  removed: readonly string[],
): string | null {
  const gone = new Set(removed);
  const positions = order.flatMap((key, index) =>
    gone.has(key) ? [index] : [],
  );
  if (positions.length === 0) return null;
  const last = Math.max(...positions);
  const after = order.slice(last + 1).find((key) => !gone.has(key));
  if (after !== undefined) return after;
  const first = Math.min(...positions);
  return (
    order
      .slice(0, first)
      .reverse()
      .find((key) => !gone.has(key)) ?? null
  );
}

/** The key of the row that holds an element, from the element itself. */
export function rowKeyOf(
  element: {
    closest(
      selector: string,
    ): { getAttribute(name: string): string | null } | null;
  } | null,
): string | null {
  return (
    element?.closest('[data-row-key]')?.getAttribute('data-row-key') ?? null
  );
}
