/**
 * The actions on the rows and the columns of a table, in one list.
 *
 * The handle of a row and the handle of a column open a menu of these
 * actions (record 0097), and the command palette offers the same list while
 * the caret is in a table, so a person meets one action with one name by two
 * roads. Each action is a format action of `@notesapp/editor`, so the menu and
 * the palette run the one edit of the table model.
 *
 * This module is pure, so a unit test holds the list, the menu of each handle
 * and what a cell allows.
 */
import {
  formatActionApplies,
  formatActionOf,
  type FormatContext,
  type TableActionId,
} from '@notesapp/editor';
import type { ActionIconName } from './palette-items.ts';

/** Which handle a menu belongs to. */
export type TableMenuKind = 'row' | 'column';

/** One action of the list, with its glyph and its place in a menu. */
export type TableActionRow = {
  readonly id: TableActionId;
  readonly icon: ActionIconName;
  readonly kind: TableMenuKind;
  /** The group of the menu: rows of one group stand together. */
  readonly group: 'insert' | 'align' | 'delete';
};

/** Every table action, in the order the menus and the palette show them. */
export const tableActionRows: readonly TableActionRow[] = [
  {
    id: 'table-row-above',
    icon: 'table-add-row',
    kind: 'row',
    group: 'insert',
  },
  {
    id: 'table-row-below',
    icon: 'table-add-row',
    kind: 'row',
    group: 'insert',
  },
  {
    id: 'table-column-left',
    icon: 'table-add-column',
    kind: 'column',
    group: 'insert',
  },
  {
    id: 'table-column-right',
    icon: 'table-add-column',
    kind: 'column',
    group: 'insert',
  },
  {
    id: 'table-align-left',
    icon: 'align-left',
    kind: 'column',
    group: 'align',
  },
  {
    id: 'table-align-center',
    icon: 'align-center',
    kind: 'column',
    group: 'align',
  },
  {
    id: 'table-align-right',
    icon: 'align-right',
    kind: 'column',
    group: 'align',
  },
  {
    id: 'table-delete-row',
    icon: 'table-remove-row',
    kind: 'row',
    group: 'delete',
  },
  {
    id: 'table-delete-column',
    icon: 'table-remove-column',
    kind: 'column',
    group: 'delete',
  },
];

/** The alignment that one alignment action sets. */
const alignOf: Readonly<
  Partial<Record<TableActionId, FormatContext['align']>>
> = {
  'table-align-left': 'left',
  'table-align-center': 'center',
  'table-align-right': 'right',
};

/** One row of the menu of a handle, before a screen gives it a glyph. */
export type TableMenuEntry = {
  readonly id: TableActionId;
  readonly label: string;
  readonly icon: ActionIconName;
  readonly group: TableActionRow['group'];
  /** True for the alignment the column has now. */
  readonly current: boolean;
  /** True for an action that removes a row or a column. */
  readonly danger: boolean;
};

/**
 * The rows of the menu of one handle, for the cell it names.
 *
 * An action that the cell does not allow is absent: the header row takes no
 * row above it and is never deleted, and the last column is never deleted.
 */
export function tableMenuEntries(
  kind: TableMenuKind,
  context: FormatContext,
): readonly TableMenuEntry[] {
  return tableActionRows
    .filter((row) => row.kind === kind)
    .filter((row) => formatActionApplies(formatActionOf(row.id), context))
    .map((row) => ({
      id: row.id,
      label: formatActionOf(row.id).label,
      icon: row.icon,
      group: row.group,
      current:
        alignOf[row.id] !== undefined && alignOf[row.id] === context.align,
      danger: row.group === 'delete',
    }));
}
