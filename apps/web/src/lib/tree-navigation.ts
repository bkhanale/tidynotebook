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

/** The place of the tree after its rows changed, and whether it takes the focus. */
export type TreePlace = {
  /** The row in the tab order, which takes the focus when the tree has it. */
  readonly key: string | null;
  /** The focus fell to the page with its row, so this row takes it. */
  readonly focus: boolean;
};

/**
 * Where the place of the tree goes after its rows changed.
 *
 * A row that leaves the tree takes no focus with it: a move to Trash from the
 * keys or from the menu of a row, a move into a closed folder, a rename of a
 * folder and a change from another device each remove the row that had it.
 * The review of the merged branch found that only the Delete key moved the
 * focus, so a move to Trash from the menu sent it to the page. One rule now
 * serves every way a row leaves: the place goes to the first row after it
 * that stays, else to the last row before it that stays, and that row takes
 * the focus when the focus fell to the page with the row that left.
 *
 * A place that the tree did not show before, such as the new row of a renamed
 * folder, stays, because the tree shows it once the rename lands.
 */
export function placeAfterChange(input: {
  /** The keys of the rows a person can act on, before the change. */
  readonly previous: readonly string[];
  /** The keys of the rows a person can act on, after the change. */
  readonly current: readonly string[];
  /** The row of the place of the tree before the change. */
  readonly key: string | null;
  /** The row with the focus left the document and the page has the focus. */
  readonly focusFell: boolean;
}): TreePlace {
  const { previous, current, key, focusFell } = input;
  if (key === null) return { key: null, focus: false };
  const stays = new Set(current);
  if (stays.has(key)) return { key, focus: focusFell };
  const at = previous.indexOf(key);
  if (at === -1) return { key, focus: false };
  const next =
    previous.slice(at + 1).find((row) => stays.has(row)) ??
    previous
      .slice(0, at)
      .reverse()
      .find((row) => stays.has(row)) ??
    null;
  return { key: next, focus: focusFell && next !== null };
}

/**
 * Whether one blur of the row with the focus gives the focus away.
 *
 * The tree remembers the row with the focus, so that the next row takes the
 * focus when that row leaves the tree (`placeAfterChange`). The row gives
 * the focus away when the focus goes to another element of the page, and
 * when it goes to no element while the document keeps the focus: a click on
 * space of the page that takes no focus. The review of the merged branch
 * found that only the first case counted, so after such a click a change
 * from another device that removed the row moved the focus and the scroll
 * back into the tree. A blur while the document loses the focus, a switch to
 * another window, keeps the row, because the focus comes back to it.
 */
export function blurLeavesRow(blur: {
  /** Where the focus goes: into the row, to another element, or to none. */
  readonly to: 'row' | 'element' | 'none';
  /** The document still has the focus, so the window did not change. */
  readonly documentFocused: boolean;
}): boolean {
  switch (blur.to) {
    case 'row':
      return false;
    case 'element':
      return true;
    case 'none':
      return blur.documentFocused;
  }
}

/**
 * Whether a key press belongs to a field inside a row, such as the name field
 * of a rename, and not to the tree.
 *
 * The field takes its own keys: the arrows move the caret and Delete removes
 * a letter. The review of the merged branch found that the tree skipped every
 * key while any rename stood open, so a field that lost its focus stopped the
 * arrows, F2 and Delete on every row. The target of the key decides now.
 */
export function isFieldKey(
  target: { closest(selector: string): unknown } | null,
): boolean {
  return (
    target !== null &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
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
