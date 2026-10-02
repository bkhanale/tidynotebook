/**
 * What a key does in the tree (record 0164).
 *
 * The keys follow the tree pattern of WAI-ARIA and the file tree of a
 * desktop: the arrows, Home and End move the focus, Right and Left open and
 * close a folder, Enter opens a row, Space adds a row to the selection, Shift
 * with an arrow extends it, Ctrl or Cmd and A selects every row, Escape
 * clears it, F2 renames, Delete moves the selection to Trash, and Shift + F10
 * and the Menu key open the menu of the selection.
 *
 * The rule is pure, so `tree-keys.test.ts` states each key.
 */

/** One key press, as the rule reads it. */
export type TreeKey = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
};

/** What one key press asks the tree to do. */
export type TreeKeyIntent =
  | 'next'
  | 'previous'
  | 'first'
  | 'last'
  | 'extend-next'
  | 'extend-previous'
  | 'expand'
  | 'collapse'
  | 'activate'
  | 'toggle-select'
  | 'select-all'
  | 'clear'
  | 'rename'
  | 'menu'
  | 'trash';

/** The intent of one key press, or `null` for a key the tree leaves alone. */
export function treeKeyIntent(press: TreeKey): TreeKeyIntent | null {
  const command = press.ctrlKey || press.metaKey;
  if (press.altKey) return null;
  switch (press.key) {
    case 'ArrowDown':
      return press.shiftKey ? 'extend-next' : 'next';
    case 'ArrowUp':
      return press.shiftKey ? 'extend-previous' : 'previous';
    case 'Home':
      return command || press.shiftKey ? null : 'first';
    case 'End':
      return command || press.shiftKey ? null : 'last';
    case 'ArrowRight':
      return command || press.shiftKey ? null : 'expand';
    case 'ArrowLeft':
      return command || press.shiftKey ? null : 'collapse';
    case 'Enter':
      return command || press.shiftKey ? null : 'activate';
    case ' ':
      return press.shiftKey ? null : 'toggle-select';
    case 'Escape':
      return 'clear';
    case 'F2':
      return command || press.shiftKey ? null : 'rename';
    case 'F10':
      return press.shiftKey && !command ? 'menu' : null;
    case 'ContextMenu':
      return 'menu';
    case 'Delete':
      return press.shiftKey ? null : 'trash';
    // Cmd + Backspace is the move to Trash of a Mac.
    case 'Backspace':
      return press.metaKey && !press.shiftKey ? 'trash' : null;
    case 'a':
    case 'A':
      return command && !press.shiftKey ? 'select-all' : null;
    default:
      return null;
  }
}
