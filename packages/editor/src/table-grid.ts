/**
 * A table of a note as a grid over its text (record 0095).
 *
 * The Markdown source stays the document, and a table stays text of the one
 * editor. This module makes that text behave as a grid: a person moves from
 * cell to cell, adds and removes rows and columns, and never meets a pipe or
 * the delimiter row. Everything a person does in a cell is an edit of the one
 * document, so undo, IME composition, find and replace, and the work of
 * another device reach a cell as they reach a paragraph (record 0082).
 *
 * The rules that shape this module:
 *
 * - The table comes from the Lezer tree, like every decoration. A cell is the
 *   stretch between two pipes, padding included, as `live-preview.ts` cuts
 *   it, because an empty cell has no node of its own.
 * - A table command reads the table into a model, changes the model, and
 *   writes the whole table again as aligned GFM. The difference is applied as
 *   the smallest character changes, so the text of a cell that the command
 *   did not change is never rewritten, and a remote edit of it survives.
 * - A caret stands in the text of a cell, never in the padding, on a pipe,
 *   or on the delimiter row. A range that a person selects is left alone.
 * - The edit of a person never removes a pipe, the delimiter row, or the
 *   line break between two rows, unless it removes the whole table.
 * - A typed pipe is escaped and a pasted line break becomes a space, so text
 *   written into a cell stays in that cell.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  EditorState,
  type ChangeSpec,
  type Extension,
  Transaction,
  type Range,
  type TransactionSpec,
} from '@codemirror/state';
import {
  BlockWrapper,
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { diffChars } from 'diff';
import { isEditOfAPerson } from './commands.ts';
import {
  delimiterRowParts,
  tableAlignments,
  type ColumnAlign,
} from './live-preview.ts';

/**
 * How long one command may parse the note to find its table, in
 * milliseconds. The parse reuses the tree of the state, so this is spent only
 * on text the parser has not read yet.
 */
const parseBudget = 25;

/** One half-open range of the document. */
type Span = { readonly from: number; readonly to: number };

/**
 * One cell of a row: the stretch between two separators, padding included,
 * and the text inside it. An empty cell has no text, so its text range is one
 * point just after the separator before it.
 */
export type TableCellBox = {
  readonly from: number;
  readonly to: number;
  readonly textFrom: number;
  readonly textTo: number;
};

/** One line of a table. */
export type TableRowBox = {
  readonly kind: 'header' | 'delimiter' | 'body';
  /** The start of the line, before any quote mark or indentation. */
  readonly lineFrom: number;
  /** The start of the row node, after any quote mark or indentation. */
  readonly from: number;
  readonly to: number;
  readonly pipes: readonly Span[];
  readonly cells: readonly TableCellBox[];
};

/** One table of the document, as the tree states it. */
export type TableBox = {
  readonly from: number;
  readonly to: number;
  /** Every line of the table in order: the header, the delimiter, the body. */
  readonly rows: readonly TableRowBox[];
};

/** The place of one cell: row 0 is the header, then the body rows in order. */
export type CellRef = { readonly row: number; readonly column: number };

/** The tree of a state, parsed up to `pos` within the budget. */
function treeOf(state: EditorState, pos: number): Tree {
  return ensureSyntaxTree(state, pos, parseBudget) ?? syntaxTree(state);
}

/** One cell from its range, with the range of its text. */
function cellBox(state: EditorState, from: number, to: number): TableCellBox {
  const text = state.doc.sliceString(from, to);
  const trimmed = text.trim();
  if (trimmed === '') {
    const at = from + Math.min(1, to - from);
    return { from, to, textFrom: at, textTo: at };
  }
  const lead = text.length - text.trimStart().length;
  return {
    from,
    to,
    textFrom: from + lead,
    textTo: from + lead + trimmed.length,
  };
}

/** The cells between the separators of one row. */
function cellsBetween(
  state: EditorState,
  from: number,
  to: number,
  pipes: readonly Span[],
): readonly TableCellBox[] {
  const cells: TableCellBox[] = [];
  let at = from;
  for (const pipe of pipes) {
    if (pipe.from > at) cells.push(cellBox(state, at, pipe.from));
    at = pipe.to;
  }
  if (to > at) cells.push(cellBox(state, at, to));
  return cells;
}

/** The model of one `Table` node. */
function tableFromNode(state: EditorState, table: SyntaxNode): TableBox {
  const rows: TableRowBox[] = [];
  for (
    let child = table.firstChild;
    child !== null;
    child = child.nextSibling
  ) {
    const lineFrom = state.doc.lineAt(child.from).from;
    if (child.name === 'TableHeader' || child.name === 'TableRow') {
      const pipes: Span[] = [];
      for (let part = child.firstChild; part !== null; part = part.nextSibling)
        if (part.name === 'TableDelimiter')
          pipes.push({ from: part.from, to: part.to });
      rows.push({
        kind: child.name === 'TableHeader' ? 'header' : 'body',
        lineFrom,
        from: child.from,
        to: child.to,
        pipes,
        cells: cellsBetween(state, child.from, child.to, pipes),
      });
      continue;
    }
    if (child.name !== 'TableDelimiter') continue;
    const parts = delimiterRowParts(
      state.doc.sliceString(child.from, child.to),
      child.from,
    );
    rows.push({
      kind: 'delimiter',
      lineFrom,
      from: child.from,
      to: child.to,
      pipes: parts.filter((part) => part.pipe),
      cells: parts
        .filter((part) => !part.pipe)
        .map((part) => cellBox(state, part.from, part.to)),
    });
  }
  return { from: table.from, to: table.to, rows };
}

/** The table that holds `pos`, or null. */
export function tableAt(state: EditorState, pos: number): TableBox | null {
  const tree = treeOf(state, pos);
  for (const side of [1, -1] as const)
    for (
      let node: SyntaxNode | null = tree.resolveInner(pos, side);
      node !== null;
      node = node.parent
    )
      if (node.name === 'Table') return tableFromNode(state, node);
  return null;
}

/** Every table that meets the range from `from` to `to`. */
export function tablesIn(
  state: EditorState,
  from: number,
  to: number,
): readonly TableBox[] {
  const tables: TableBox[] = [];
  treeOf(state, to).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'Table') return true;
      tables.push(tableFromNode(state, node.node));
      return false;
    },
  });
  return tables;
}

/** The rows a person edits: the header and the body, not the delimiter. */
function gridRows(table: TableBox): readonly TableRowBox[] {
  return table.rows.filter((row) => row.kind !== 'delimiter');
}

/** The line of the table that holds `pos`, or null. */
function rowAt(table: TableBox, pos: number): TableRowBox | null {
  return table.rows.find((row) => pos >= row.lineFrom && pos <= row.to) ?? null;
}

/** The index of the cell of `row` that holds `pos`. */
function columnAt(row: TableRowBox, pos: number): number {
  let column = 0;
  row.cells.forEach((cell, index) => {
    if (pos >= cell.from) column = index;
  });
  return column;
}

/** The cell that holds `pos`, or null outside the header and the body. */
export function cellAt(table: TableBox, pos: number): CellRef | null {
  const rows = gridRows(table);
  const row = rowAt(table, pos);
  if (row === null || row.kind === 'delimiter' || row.cells.length === 0)
    return null;
  return { row: rows.indexOf(row), column: columnAt(row, pos) };
}

/** Whether `pos` stands in a cell a person can write in. */
export function inTableCell(state: EditorState, pos: number): boolean {
  const table = tableAt(state, pos);
  if (table === null) return false;
  const row = rowAt(table, pos);
  return row !== null && row.kind !== 'delimiter' && pos >= row.from;
}

/** What a person reads in a table: the text of each cell, and the columns. */
export type TableData = {
  /** What stands before each line after the first: quote marks or spaces. */
  readonly lead: string;
  readonly alignments: readonly ColumnAlign[];
  readonly header: readonly string[];
  readonly body: readonly (readonly string[])[];
};

/**
 * The data of one table.
 *
 * The table takes as many columns as its widest row, so a cell that a row
 * holds beyond the header is kept and not dropped when the table is written.
 */
export function tableData(state: EditorState, table: TableBox): TableData {
  const rows = gridRows(table);
  const delimiter = table.rows.find((row) => row.kind === 'delimiter');
  const alignments =
    delimiter === undefined
      ? []
      : tableAlignments(state.doc.sliceString(delimiter.from, delimiter.to));
  const columns = Math.max(
    1,
    alignments.length,
    ...rows.map((row) => row.cells.length),
  );
  const texts = (row: TableRowBox): readonly string[] =>
    Array.from({ length: columns }, (_, index) => {
      const cell = row.cells[index];
      return cell === undefined
        ? ''
        : state.doc.sliceString(cell.textFrom, cell.textTo);
    });
  const second = table.rows[1];
  return {
    lead:
      second === undefined
        ? ''
        : state.doc.sliceString(second.lineFrom, second.from),
    alignments: Array.from(
      { length: columns },
      (_, index) => alignments[index] ?? null,
    ),
    header: rows[0] === undefined ? [] : texts(rows[0]),
    body: rows.slice(1).map(texts),
  };
}

/** One table written as text, and where each cell lands in it. */
export type WrittenTable = {
  readonly text: string;
  /** The text range of one cell, as offsets into `text`. */
  readonly cell: (ref: CellRef) => Span;
};

/** The dashes of one delimiter cell, with the colons of its alignment. */
function delimiterCell(align: ColumnAlign, width: number): string {
  if (align === 'left') return `:${'-'.repeat(width - 1)}`;
  if (align === 'right') return `${'-'.repeat(width - 1)}:`;
  if (align === 'center') return `:${'-'.repeat(width - 2)}:`;
  return '-'.repeat(width);
}

/**
 * Writes one table as aligned GFM.
 *
 * Every row has a pipe at each edge, one space of padding on each side of a
 * cell, and every cell of a column is as wide as the widest, at least three,
 * so the delimiter row keeps its dashes. The lines after the first repeat the
 * lead of the table, so a table in a quote stays in the quote.
 */
export function writeTable(data: TableData): WrittenTable {
  const columns = data.alignments.length;
  const rows = [data.header, ...data.body];
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(3, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    `|${widths
      .map((width, column) => ` ${(cells[column] ?? '').padEnd(width)} `)
      .join('|')}|`;
  const delimiter = `|${widths
    .map(
      (width, column) =>
        ` ${delimiterCell(data.alignments[column] ?? null, width)} `,
    )
    .join('|')}|`;
  const lines = [line(data.header), delimiter, ...data.body.map(line)];
  const separator = `\n${data.lead}`;
  const lineStart = (index: number): number =>
    lines
      .slice(0, index)
      .reduce((sum, text) => sum + text.length + separator.length, 0);
  return {
    text: lines.join(separator),
    cell: ({ row, column }): Span => {
      const from =
        lineStart(row === 0 ? 0 : row + 1) +
        2 +
        widths.slice(0, column).reduce((sum, width) => sum + width + 3, 0);
      const text = rows[row]?.[column] ?? '';
      return { from, to: from + text.length };
    },
  };
}

/**
 * The smallest character changes that turn one table into its new text.
 *
 * A command writes the whole table again, and most of it is the same. The
 * changes keep every unchanged character where it is, so the text of a cell
 * that the command did not touch is never replaced.
 */
function tableChanges(
  state: EditorState,
  table: TableBox,
  text: string,
): readonly ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  let at = table.from;
  for (const part of diffChars(
    state.doc.sliceString(table.from, table.to),
    text,
  )) {
    if (part.added === true) changes.push({ from: at, insert: part.value });
    else if (part.removed === true) {
      changes.push({ from: at, to: at + part.value.length });
      at += part.value.length;
    } else at += part.value.length;
  }
  return changes;
}

/** What a table command leaves: the new data and the cell it moves to. */
type TableEditResult = {
  readonly data: TableData;
  readonly target: CellRef;
  /** `text` selects the text of the target cell; `end` puts the caret after it. */
  readonly select: 'text' | 'end';
};

/** One table command, as a change of the data at one cell. */
type TableEdit = (data: TableData, at: CellRef) => TableEditResult | null;

/**
 * The transaction of one table command at the main selection.
 *
 * It runs with `filter: false`, because the command is the one edit that may
 * move a pipe, and the caret it sets is already inside a cell.
 */
function tableCommandSpec(
  state: EditorState,
  edit: TableEdit,
): TransactionSpec | null {
  const head = state.selection.main.head;
  const table = tableAt(state, head);
  if (table === null) return null;
  const at = cellAt(table, head);
  if (at === null) return null;
  const result = edit(tableData(state, table), at);
  if (result === null) return null;
  const written = writeTable(result.data);
  const cell = written.cell(result.target);
  const from = table.from + cell.from;
  const to = table.from + cell.to;
  return {
    changes: tableChanges(state, table, written.text),
    selection:
      result.select === 'text'
        ? EditorSelection.range(from, to)
        : EditorSelection.cursor(to),
    filter: false,
  };
}

/** A body row of empty cells. */
function emptyRow(data: TableData): readonly string[] {
  return data.alignments.map(() => '');
}

/** The data with one more empty body row at body index `index`. */
function withRow(data: TableData, index: number): TableData {
  const body = [...data.body];
  body.splice(index, 0, emptyRow(data));
  return { ...data, body };
}

/** The number of rows a person moves through: the header and the body. */
function rowCount(data: TableData): number {
  return data.body.length + 1;
}

/** Moves to the next cell, and adds a row after the last one. */
export const nextCellEdit: TableEdit = (data, at) => {
  const columns = data.alignments.length;
  if (at.column + 1 < columns)
    return { data, target: { ...at, column: at.column + 1 }, select: 'text' };
  const next = { row: at.row + 1, column: 0 };
  if (next.row < rowCount(data)) return { data, target: next, select: 'text' };
  return {
    data: withRow(data, data.body.length),
    target: next,
    select: 'text',
  };
};

/** Moves to the previous cell. Declines in the first cell. */
export const previousCellEdit: TableEdit = (data, at) => {
  if (at.column > 0)
    return { data, target: { ...at, column: at.column - 1 }, select: 'text' };
  if (at.row === 0) return null;
  return {
    data,
    target: { row: at.row - 1, column: data.alignments.length - 1 },
    select: 'text',
  };
};

/** Moves to the cell below, and adds a row under the last one. */
export const cellBelowEdit: TableEdit = (data, at) => {
  const below = { ...at, row: at.row + 1 };
  if (below.row < rowCount(data)) return { data, target: below, select: 'end' };
  return {
    data: withRow(data, data.body.length),
    target: below,
    select: 'end',
  };
};

/** Moves to the cell above. In the header it stays where it is. */
export const cellAboveEdit: TableEdit = (data, at) => ({
  data,
  target: at.row === 0 ? at : { ...at, row: at.row - 1 },
  select: 'end',
});

/** Adds an empty row under the row of the caret. */
export const addRowEdit: TableEdit = (data, at) => ({
  data: withRow(data, at.row),
  target: { row: at.row + 1, column: at.column },
  select: 'end',
});

/** Removes the body row of the caret. The header row stays. */
export const removeRowEdit: TableEdit = (data, at) => {
  if (at.row === 0) return null;
  const body = data.body.filter((_, index) => index !== at.row - 1);
  return {
    data: { ...data, body },
    target: { row: Math.min(at.row, body.length), column: at.column },
    select: 'end',
  };
};

/** Adds an empty column after the column of the caret. */
export const addColumnEdit: TableEdit = (data, at) => {
  const index = at.column + 1;
  const insert = <T>(cells: readonly T[], value: T): readonly T[] => [
    ...cells.slice(0, index),
    value,
    ...cells.slice(index),
  ];
  return {
    data: {
      ...data,
      alignments: insert(data.alignments, null),
      header: insert(data.header, ''),
      body: data.body.map((row) => insert(row, '')),
    },
    target: { row: 0, column: index },
    select: 'end',
  };
};

/** Removes the column of the caret. The last column stays. */
export const removeColumnEdit: TableEdit = (data, at) => {
  const columns = data.alignments.length;
  if (columns <= 1) return null;
  const without = <T>(cells: readonly T[]): readonly T[] =>
    cells.filter((_, index) => index !== at.column);
  return {
    data: {
      ...data,
      alignments: without(data.alignments),
      header: without(data.header),
      body: data.body.map(without),
    },
    target: { row: at.row, column: Math.min(at.column, columns - 2) },
    select: 'end',
  };
};

/** The transaction of one table edit at the main selection, or null. */
export function tableEditSpec(
  state: EditorState,
  edit: TableEdit,
): TransactionSpec | null {
  return tableCommandSpec(state, edit);
}

/**
 * Where a caret goes that a move put at `pos`.
 *
 * A vertical move and a pointer land in the cell under them, at the edge of
 * its text that is nearest. A move along a line steps from one cell text to
 * the next: out of the last cell of a row into the first cell of the next,
 * and out of the table at its first and its last cell. A move that jumps to
 * the end or the start of a line stops at the last or the first cell of it.
 */
function caretPlace(
  state: EditorState,
  pos: number,
  from: number,
  pointer: boolean,
): number {
  const table = tableAt(state, pos);
  if (table === null) return pos;
  const row = rowAt(table, pos);
  if (row === null) return pos;
  const rows = gridRows(table);
  const inside = (cell: TableCellBox): boolean =>
    pos >= cell.textFrom && pos <= cell.textTo;

  if (row.kind === 'delimiter') {
    const column = columnAt(row, pos);
    const down = pos >= from;
    const header = rows[0];
    const target = down ? (rows[1] ?? header) : header;
    const cell =
      target?.cells[Math.min(column, (target?.cells.length ?? 1) - 1)];
    return cell === undefined ? pos : cell.textTo;
  }
  const cells = row.cells;
  if (cells.length === 0) return pos;
  if (cells.some(inside)) return pos;

  const vertical =
    pointer || state.doc.lineAt(from).number !== state.doc.lineAt(pos).number;
  if (vertical) {
    const cell = cells[columnAt(row, pos)];
    if (cell === undefined) return pos;
    return pos < cell.textFrom ? cell.textFrom : cell.textTo;
  }

  const first = cells[0];
  const last = cells[cells.length - 1];
  if (first === undefined || last === undefined) return pos;
  const index = rows.indexOf(row);
  if (pos > from) {
    const ahead = cells.find((cell) => cell.textFrom >= pos);
    if (ahead !== undefined) return ahead.textFrom;
    if (from !== last.textTo) return last.textTo;
    const next = rows[index + 1]?.cells[0];
    if (next !== undefined) return next.textFrom;
    return table.to < state.doc.length ? table.to + 1 : last.textTo;
  }
  const behind = [...cells].reverse().find((cell) => cell.textTo <= pos);
  if (behind !== undefined) return behind.textTo;
  if (from !== first.textFrom) return first.textFrom;
  const previous = rows[index - 1]?.cells.at(-1);
  if (previous !== undefined) return previous.textTo;
  const start = rows[0]?.lineFrom ?? table.from;
  return start > 0 ? start - 1 : first.textFrom;
}

/** Holds each caret that a move of a person put in a table inside a cell. */
function caretFilter(
  transaction: Transaction,
): TransactionSpec | readonly TransactionSpec[] {
  const selection = transaction.selection;
  if (selection === undefined || !transaction.isUserEvent('select'))
    return transaction;
  const before = transaction.startState.selection;
  const pointer = transaction.isUserEvent('select.pointer');
  let moved = false;
  const ranges = selection.ranges.map((range, index) => {
    if (!range.empty) return range;
    const from = (before.ranges[index] ?? before.main).head;
    const place = caretPlace(transaction.state, range.head, from, pointer);
    if (place === range.head) return range;
    moved = true;
    return EditorSelection.cursor(place);
  });
  if (!moved) return transaction;
  return [
    transaction,
    {
      selection: EditorSelection.create(ranges, selection.mainIndex),
      sequential: true,
    },
  ];
}

/**
 * The ranges of the start document that the edit of a person may not change.
 *
 * They are the pipes, the delimiter row, and the line break and the lead
 * between two rows, of every table the edit meets. A table that one change
 * covers from its first line to its end is removed as a whole, so it keeps
 * nothing.
 */
function protectedRanges(transaction: Transaction): readonly number[] | true {
  if (!isEditOfAPerson(transaction)) return true;
  const touched: Span[] = [];
  transaction.changes.iterChangedRanges((fromA, toA) => {
    touched.push({ from: fromA, to: toA });
  });
  if (touched.length === 0) return true;
  const low = Math.min(...touched.map((span) => span.from));
  const high = Math.max(...touched.map((span) => span.to));
  const ranges: number[] = [];
  for (const table of tablesIn(transaction.startState, low, high)) {
    const start = table.rows[0]?.lineFrom ?? table.from;
    if (touched.some((span) => span.from <= start && span.to >= table.to))
      continue;
    table.rows.forEach((row, index) => {
      if (index > 0) {
        const above = table.rows[index - 1];
        if (above !== undefined) ranges.push(above.to, row.from);
      }
      if (row.kind === 'delimiter') ranges.push(row.from, row.to);
      else for (const pipe of row.pipes) ranges.push(pipe.from, pipe.to);
    });
  }
  return ranges.length === 0 ? true : ranges;
}

/**
 * The text a person writes into a cell, made to stay in that cell.
 *
 * A pipe that no backslash escapes would start a new cell, so it gets one. A
 * line break would end the row, so it becomes a space.
 */
export function cellText(text: string, escaped: boolean): string {
  let out = '';
  let previousBackslash = escaped;
  for (const char of text.replaceAll(/\r?\n/g, ' ')) {
    out += char === '|' && !previousBackslash ? '\\|' : char;
    previousBackslash = char === '\\' && !previousBackslash;
  }
  return out;
}

/** Keeps what a person types or pastes into a cell inside that cell. */
function cellInputFilter(
  transaction: Transaction,
): TransactionSpec | readonly TransactionSpec[] {
  if (
    !transaction.isUserEvent('input.type') &&
    !transaction.isUserEvent('input.paste') &&
    !transaction.isUserEvent('input.drop')
  )
    return transaction;
  if (transaction.isUserEvent('input.type.compose')) return transaction;
  const start = transaction.startState;
  const changes: ChangeSpec[] = [];
  let rewritten = false;
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    if (/[\n|]/.test(text) && inTableCell(start, fromA)) {
      const escaped = start.doc.sliceString(fromA - 1, fromA) === '\\';
      const safe = cellText(text, escaped);
      if (safe !== text) rewritten = true;
      changes.push({ from: fromA, to: toA, insert: safe });
      return;
    }
    changes.push({ from: fromA, to: toA, insert: text });
  });
  if (!rewritten) return transaction;
  const set = start.changes(changes);
  const userEvent = transaction.annotation(Transaction.userEvent);
  return {
    changes: set,
    selection: start.selection.map(set, 1),
    ...(userEvent === undefined ? {} : { userEvent }),
    scrollIntoView: transaction.scrollIntoView,
  };
}

/**
 * Where the caret of a state stands, for the formatting row.
 *
 * `table` is true in a cell. `bodyRow` is true in a row that can be removed,
 * which the header is not, and `columns` counts the columns of the table, so
 * the last one is never offered for removal.
 */
export type FormatContext = {
  readonly table: boolean;
  readonly bodyRow: boolean;
  readonly columns: number;
};

/** The format context of a caret outside every table. */
export const outsideTable: FormatContext = {
  table: false,
  bodyRow: false,
  columns: 0,
};

/** The format context of one state. */
export function formatContextOf(state: EditorState): FormatContext {
  const head = state.selection.main.head;
  if (!inTableCell(state, head)) return outsideTable;
  const table = tableAt(state, head);
  const cell = table === null ? null : cellAt(table, head);
  if (table === null || cell === null) return outsideTable;
  return {
    table: true,
    bodyRow: cell.row > 0,
    columns: tableData(state, table).alignments.length,
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
    left.columns === right.columns
  );
}

/** What the grid adds to the view of the tables it can see. */
type GridParts = {
  readonly wrappers: ReturnType<typeof BlockWrapper.set>;
  readonly atomic: DecorationSet;
};

/** The element that wraps the lines of one table. */
const tableWrapper = BlockWrapper.create({
  tagName: 'div',
  attributes: { class: 'cm-np-table' },
});

/** The ranges that a caret and a deletion treat as one unit. */
const atomicMark = Decoration.mark({});

/**
 * The wrappers and the atomic ranges of every table in the visible ranges.
 *
 * A wrapper runs from the start of the first line of a table to its end, so
 * the rows of a table in a quote are wrapped with their quote marks. The pipes
 * and the delimiter row are atomic, so an arrow key steps over them.
 */
export function gridParts(
  state: EditorState,
  ranges: readonly Span[],
): GridParts {
  const wrappers: Range<BlockWrapper>[] = [];
  const atomic: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const range of ranges)
    for (const table of tablesIn(state, range.from, range.to)) {
      if (seen.has(table.from)) continue;
      seen.add(table.from);
      const start = table.rows[0]?.lineFrom ?? table.from;
      wrappers.push(tableWrapper.range(start, table.to));
      for (const row of table.rows) {
        if (row.kind === 'delimiter') {
          if (row.to > row.from)
            atomic.push(atomicMark.range(row.from, row.to));
          continue;
        }
        for (const pipe of row.pipes)
          atomic.push(atomicMark.range(pipe.from, pipe.to));
      }
    }
  return {
    wrappers: BlockWrapper.set(wrappers, true),
    atomic: Decoration.set(atomic, true),
  };
}

/** Builds the grid parts of the view and keeps them current. */
const gridView = ViewPlugin.fromClass(
  class {
    parts: GridParts;

    constructor(view: EditorView) {
      this.parts = gridParts(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate): void {
      if (
        !update.docChanged &&
        !update.viewportChanged &&
        syntaxTree(update.startState) === syntaxTree(update.state)
      )
        return;
      this.parts = gridParts(update.view.state, update.view.visibleRanges);
    }
  },
  {
    provide: (plugin) => [
      EditorView.blockWrappers.of(
        (view) => view.plugin(plugin)?.parts.wrappers ?? BlockWrapper.set([]),
      ),
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.parts.atomic ?? Decoration.none,
      ),
    ],
  },
);

/** How a table looks: one scrolling grid for each table (record 0095). */
export function tableGridView(): Extension {
  return gridView;
}

/** How a table is edited: the caret, the protected text, and the input. */
export function tableGridEditing(): Extension {
  return [
    EditorState.transactionFilter.of(caretFilter),
    EditorState.transactionFilter.of(cellInputFilter),
    EditorState.changeFilter.of(protectedRanges),
  ];
}
