/**
 * The rows of the tree that a person can see, as one list (record 0164).
 *
 * The tree was a list in a list for each open folder. The tree pattern of
 * WAI-ARIA needs no nesting: each row states its level, its place among its
 * siblings and the count of its siblings. One list serves the arrow keys,
 * which walk it in order, a screen reader, which reads the level and the
 * place, and the window of record 0165, which cuts it at any row.
 *
 * The module is pure, so `tree-rows.test.ts` states every rule.
 */
import type { NoteSummary, TreeNode } from './note-list.ts';
import { displayNoteName } from './note-name.ts';

/** What every visible row states about its place in the tree. */
type RowPlace = {
  /** A value that is unique among the rows and stable across renders. */
  readonly key: string;
  /** One for a row at the top of the tree. */
  readonly level: number;
  /** The place of the row among its siblings, from one. */
  readonly posInSet: number;
  /** How many siblings the row has, itself included. */
  readonly setSize: number;
  /** The key of the folder that holds the row, or `null` at the top. */
  readonly parentKey: string | null;
};

/** One row of the tree that a person can see. */
export type TreeRowEntry =
  | (RowPlace & {
      readonly kind: 'folder';
      /** The full path of the folder. */
      readonly path: string;
      readonly name: string;
      readonly expanded: boolean;
    })
  | (RowPlace & {
      readonly kind: 'note';
      readonly note: NoteSummary;
      /** The name of the note, without its folder and its suffix. */
      readonly name: string;
    })
  | {
      /** The line that an open folder with no row in it shows. */
      readonly kind: 'empty';
      readonly key: string;
      readonly level: number;
      readonly parentKey: string;
    };

/** The key of the row of one folder. */
export function folderRowKey(path: string): string {
  return `folder:${path}`;
}

/** The key of the row of one note. */
export function noteRowKey(fileId: string): string {
  return `note:${fileId}`;
}

/**
 * Every row a person can see, in the order of the screen.
 *
 * A folder lists its rows below it while it is open. An open folder with no
 * row shows one line that says so, which takes no place among the rows a
 * person can act on.
 */
export function visibleTreeRows(
  nodes: readonly TreeNode[],
  openFolders: ReadonlySet<string>,
): readonly TreeRowEntry[] {
  const rows: TreeRowEntry[] = [];
  const walk = (
    level: readonly TreeNode[],
    depth: number,
    parentKey: string | null,
  ): void => {
    level.forEach((node, index) => {
      const place = {
        level: depth,
        posInSet: index + 1,
        setSize: level.length,
        parentKey,
      };
      if (node.kind === 'note') {
        rows.push({
          ...place,
          kind: 'note',
          key: noteRowKey(node.note.fileId),
          note: node.note,
          name: displayNoteName(node.basename),
        });
        return;
      }
      const key = folderRowKey(node.fullPath);
      const expanded = openFolders.has(node.fullPath);
      rows.push({
        ...place,
        kind: 'folder',
        key,
        path: node.fullPath,
        name: node.name,
        expanded,
      });
      if (!expanded) return;
      if (node.children.length === 0)
        rows.push({
          kind: 'empty',
          key: `empty:${node.fullPath}`,
          level: depth + 1,
          parentKey: key,
        });
      else walk(node.children, depth + 1, key);
    });
  };
  walk(nodes, 1, null);
  return rows;
}

/** A row that a person can focus and act on, which is any row but a line. */
export type ActionableRow = Exclude<TreeRowEntry, { readonly kind: 'empty' }>;

/** Whether a row is one a person can focus and act on. */
export function isActionable(row: TreeRowEntry): row is ActionableRow {
  return row.kind !== 'empty';
}

/** The keys of the rows a person can act on, in the order of the screen. */
export function actionableKeys(
  rows: readonly TreeRowEntry[],
): readonly string[] {
  return rows.filter(isActionable).map((row) => row.key);
}
