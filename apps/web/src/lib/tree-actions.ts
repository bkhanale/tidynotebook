/**
 * The menu of a row of the tree and of a selection (record 0164).
 *
 * The action button of a row, a right click, Shift + F10 and the Menu key
 * open one menu, and this module decides its rows. A note row reads the rows
 * of the note menu from `note-menu.ts`, the same table the header reads, so
 * a word cannot drift between the two. A folder row has the actions of a
 * folder. A selection of several rows has the two actions that mean the same
 * thing for each row: Move to folder and Move to Trash. Move to Trash is the
 * pinned row of each menu, under the separator, away from the row a person
 * reaches for by mistake.
 *
 * Each row is an operation that exists: a move and a move to Trash are one
 * operation of the local store (record 0032), Duplicate makes a note
 * (record 0104), and Copy link writes to the clipboard. The module is pure,
 * so `tree-actions.test.ts` holds every row.
 */
import { displayNoteName } from './note-name.ts';
import {
  noteMenuRows,
  noteTrashRow,
  type NoteMenuAction,
} from './note-menu.ts';
import type { ActionIconName } from './palette-items.ts';

/** One row of the tree that an action can start from. */
export type TreeTarget =
  | {
      readonly kind: 'note';
      readonly fileId: string;
      readonly path: string;
    }
  | { readonly kind: 'folder'; readonly path: string };

/** What one row of a tree menu runs. */
export type TreeAction =
  NoteMenuAction | 'new-note' | 'new-folder' | 'move-to-trash';

/** One row of a tree menu, before the screen gives it a glyph and a handler. */
export type TreeActionRow = {
  readonly id: TreeAction;
  readonly label: string;
  readonly icon: ActionIconName;
};

/** The rows of one tree menu and the name of the menu. */
export type TreeMenu = {
  /** The accessible name of the menu. */
  readonly label: string;
  readonly rows: readonly TreeActionRow[];
  /** The rows under the separator. */
  readonly pinned: readonly TreeActionRow[];
};

/** The rows of the menu of one folder, in the order a person reads them. */
const folderRows: readonly TreeActionRow[] = [
  { id: 'new-note', label: 'New note in this folder', icon: 'new-note' },
  { id: 'new-folder', label: 'New folder in this folder', icon: 'new-folder' },
  { id: 'rename', label: 'Rename', icon: 'rename' },
  { id: 'move', label: 'Move to folder', icon: 'move' },
  { id: 'publish', label: 'Publish', icon: 'publish' },
];

/** The rows of the menu of a selection of several rows. */
const selectionRows: readonly TreeActionRow[] = [
  { id: 'move', label: 'Move to folder', icon: 'move' },
];

/** The last segment of a folder path. */
function folderName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

/** `1 item` or `3 items`. */
function itemCount(count: number): string {
  return count === 1 ? '1 item' : `${String(count)} items`;
}

/** The menu that an action started from one or more rows opens. */
export function treeMenu(targets: readonly TreeTarget[]): TreeMenu {
  const pinned = [noteTrashRow];
  const only = targets.length === 1 ? targets[0] : undefined;
  if (only === undefined)
    return {
      label: `Actions for ${itemCount(targets.length)}`,
      rows: selectionRows,
      pinned,
    };
  if (only.kind === 'folder')
    return {
      label: `Actions for the folder ${folderName(only.path)}`,
      rows: folderRows,
      pinned,
    };
  return {
    label: `Actions for the note ${displayNoteName(only.path.split('/').at(-1) ?? only.path)}`,
    rows: noteMenuRows({ canMove: true, canPublish: true, surface: 'tree' }),
    pinned,
  };
}

/**
 * The words that tell the person what a move to Trash moved.
 *
 * A folder and a note are both items of the tree, so a selection names its
 * count of items, and the bar after the move names its count of notes.
 */
export function selectionLabel(count: number): string {
  return `${itemCount(count)} selected`;
}

/** The names that one row of the tree and its two controls state. */
export type TreeRowControls = {
  /** The name of the treeitem: the name of the row and its one fact. */
  readonly label: string;
  /** The name of the chevron of a folder, or `null` for a note. */
  readonly toggle: string | null;
  /** The name of the action button, which opens the menu of the row. */
  readonly actions: string;
};

/**
 * The accessible names of one row and of its chevron and action button.
 *
 * A screen reader on a touch screen has no Shift + F10 and no Menu key, and
 * a double tap on a folder row selects the folder and does not close it. It
 * reaches the menu and the chevron by a swipe, so both controls are in the
 * accessibility tree with these names, out of the tab order of the keys.
 * The treeitem states its own name, so the names of the two controls do not
 * become a part of the name of the row.
 */
export function treeRowControls(row: {
  readonly kind: 'note' | 'folder';
  readonly name: string;
  readonly expanded?: boolean | undefined;
  /** The note is on this device only. */
  readonly local?: boolean | undefined;
}): TreeRowControls {
  const label =
    row.local === true ? `${row.name}, on this device only` : row.name;
  if (row.kind === 'note')
    return { label, toggle: null, actions: `Actions for the note ${row.name}` };
  return {
    label,
    toggle: `${row.expanded === true ? 'Collapse' : 'Expand'} folder ${row.name}`,
    actions: `Actions for the folder ${row.name}`,
  };
}
