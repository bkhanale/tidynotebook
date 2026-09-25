/**
 * Where the caret of a state stands, for the formatting row (record 0094).
 *
 * The row, the palette and the menu of a table handle read one context to
 * decide which action applies: the table of the caret (record 0095) and the
 * places that the list item of the caret can move to (record 0106).
 */
import type { EditorState } from '@codemirror/state';
import {
  listMoveContextOf,
  outsideListItem,
  type ListMoveContext,
} from './list-move.ts';
import {
  outsideTable,
  tableContextAt,
  type TableContext,
} from './table-grid.ts';

/** Where the caret stands: its table, and where its list item can go. */
export type FormatContext = TableContext & ListMoveContext;

/** The format context of a caret in plain text. */
export const plainTextContext: FormatContext = {
  ...outsideTable,
  ...outsideListItem,
};

/**
 * The format context of the cell at `pos`, for the menu of a table handle,
 * which acts on its cell and never on a list item.
 */
export function cellFormatContext(
  state: EditorState,
  pos: number,
): FormatContext {
  return { ...tableContextAt(state, pos), ...outsideListItem };
}

/** The format context of the caret of one state. */
export function formatContextOf(state: EditorState): FormatContext {
  return {
    ...tableContextAt(state, state.selection.main.head),
    ...listMoveContextOf(state),
  };
}

/** Whether two format contexts state the same place. */
export function sameFormatContext(
  left: FormatContext,
  right: FormatContext,
): boolean {
  return (
    left.table === right.table &&
    left.bodyRow === right.bodyRow &&
    left.row === right.row &&
    left.rows === right.rows &&
    left.column === right.column &&
    left.columns === right.columns &&
    left.align === right.align &&
    left.itemUp === right.itemUp &&
    left.itemDown === right.itemDown
  );
}
