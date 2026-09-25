/**
 * Keeps every ordered list that an edit touches in sequence (record 0089).
 *
 * A reader numbers a list from its first item and counts every later item
 * from there, so a written number that is out of sequence says something that
 * no reader shows. The live preview already draws the value a reader gives an
 * item. This module keeps the source equal to it, so the file reads the same
 * in any other Markdown tool.
 *
 * The rules that shape this module:
 *
 * - One transaction filter carries the whole rule. The numbers change in the
 *   same transaction as the edit, so one undo step removes the edit and its
 *   numbers together, in the CodeMirror history of a plain editor and in the
 *   Yjs undo of a bound one, which takes one transaction as one change.
 * - Only the edit of a person is renumbered: typing, a paste, a drop, a
 *   deletion, and a command. A remote change, an undo, a redo, and a
 *   composition carry no such event, so they are never renumbered. Two
 *   devices therefore never write numbers over the work of each other.
 * - Only the lists the edit touched change. A list elsewhere in the note keeps
 *   the numbers it has, so opening an old note writes nothing.
 * - The lists come from the Lezer tree, like every decoration, so a list in a
 *   quote, a lazy line, and a fenced block read as the reader reads them.
 * - A list keeps its start. The start changes only when the edit wrote the
 *   first marker itself. A list that an indent or an outdent makes has no
 *   start of its own yet, so a nested one starts at one, which is also the only
 *   start CommonMark lets interrupt the text of an item.
 * - A marker that grows, as `9.` does into `10.`, moves the later lines of its
 *   item by the same width, so the children of the item stay its children. A
 *   marker that shrinks moves them back.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  EditorState,
  type ChangeSpec,
  type Extension,
  type Text,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { isEditOfAPerson } from './commands.ts';
import { parseListLine } from './list-line.ts';

/**
 * How long one edit may parse the note to find its lists, in milliseconds.
 *
 * The editor parses near the viewport, and a list can run past it. The parse
 * reuses the tree of the previous state, so this is spent only on text the
 * parser has not read yet. When it runs out, the lists are read from the part
 * of the tree that reaches past the edit.
 */
const parseBudget = 25;

/** One range of the new document that an edit changed. */
type Changed = {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
};

/** The ranges one transaction changed, in both documents. */
function changedRanges(transaction: Transaction): readonly Changed[] {
  const ranges: Changed[] = [];
  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    ranges.push({ fromA, toA, fromB, toB });
  });
  return ranges;
}

/** Whether a position sits in the list marker of its line, or before it. */
function inMarker(state: EditorState, position: number): boolean {
  const line = state.doc.lineAt(position);
  const parsed = parseListLine(line.text);
  return parsed !== null && position - line.from <= parsed.prefixLength;
}

/**
 * Whether one edit can change the numbers of a list.
 *
 * A list changes shape only when a line starts or ends, or when a marker or
 * the indentation before it changes. Typing inside the text of an item does
 * neither, so the common key press costs one line test and no parse.
 */
function canRenumber(transaction: Transaction, changed: Changed): boolean {
  const before = transaction.startState.doc.sliceString(
    changed.fromA,
    changed.toA,
  );
  const after = transaction.newDoc.sliceString(changed.fromB, changed.toB);
  if (before.includes('\n') || after.includes('\n')) return true;
  return (
    inMarker(transaction.startState, changed.fromA) ||
    inMarker(transaction.state, changed.fromB)
  );
}

/** The tree of one state, parsed at least to a position, or `null`. */
function treeTo(state: EditorState, position: number): Tree | null {
  return (
    ensureSyntaxTree(state, state.doc.length, parseBudget) ??
    ensureSyntaxTree(state, position, parseBudget)
  );
}

/**
 * The range from the line above one range to the line below it.
 *
 * A line that joins two lists, leaves one, or moves out of one changes the
 * list on the line beside it, and a nested list starts after the spaces of
 * its line, so the reach is whole lines and not one character.
 */
function withLinesAround(
  state: EditorState,
  from: number,
  to: number,
): { readonly from: number; readonly to: number } {
  const doc = state.doc;
  const first = doc.lineAt(from);
  const last = doc.lineAt(to);
  return {
    from: first.number > 1 ? doc.line(first.number - 1).from : first.from,
    to: last.number < doc.lines ? doc.line(last.number + 1).to : last.to,
  };
}

/** The ordered lists of a tree that meet one range, ancestors included. */
function orderedListsAround(
  tree: Tree,
  from: number,
  to: number,
  found: Map<number, SyntaxNode>,
): void {
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === 'OrderedList' && !found.has(node.from))
        found.set(node.from, node.node);
    },
  });
}

/** The items of one list, in order. */
function itemsOf(list: SyntaxNode): readonly SyntaxNode[] {
  return list.getChildren('ListItem');
}

/** The digits and the range of the number of one ordered item. */
export function numberOf(
  state: EditorState,
  item: SyntaxNode,
): { readonly from: number; readonly digits: string } | null {
  const mark = item.getChild('ListMark');
  if (mark === null) return null;
  const digits = /^\d+/.exec(state.doc.sliceString(mark.from, mark.to))?.[0];
  if (digits === undefined) return null;
  return { from: mark.from, digits };
}

/** Whether a node sits inside a block quote. */
function insideQuote(node: SyntaxNode): boolean {
  for (let at = node.parent; at !== null; at = at.parent)
    if (at.name === 'Blockquote') return true;
  return false;
}

/**
 * Adds the shift of the later lines of one item whose marker grew or shrank
 * by `width` columns, so the children of the item stay its children.
 *
 * `shifts` maps the start of a line to its width, so the shifts of a nested
 * item and of the item that holds it add up on the lines they share. The
 * lines of an item in a quote stay, because their quote marks come first.
 */
export function addItemShift(
  doc: Text,
  item: SyntaxNode,
  width: number,
  shifts: Map<number, number>,
): void {
  if (width === 0 || insideQuote(item)) return;
  const first = doc.lineAt(item.from).number;
  // An item that ends where a line starts ends on the line above it, so
  // the marker line of the next item never moves with this one.
  const end = doc.lineAt(item.to);
  const last =
    end.from === item.to && item.to > item.from ? end.number - 1 : end.number;
  for (let at = first + 1; at <= last; at += 1) {
    const from = doc.line(at).from;
    shifts.set(from, (shifts.get(from) ?? 0) + width);
  }
}

/**
 * The changes that move each line of `shifts` by its width.
 *
 * A blank line and a line indented with a tab stay, and a line never loses
 * more spaces than it has.
 */
export function lineShiftChanges(
  doc: Text,
  shifts: ReadonlyMap<number, number>,
): readonly ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  for (const [from, width] of shifts) {
    const line = doc.lineAt(from);
    if (width === 0 || line.text.trim() === '' || line.text.startsWith('\t'))
      continue;
    if (width > 0) {
      changes.push({ from, insert: ' '.repeat(width) });
      continue;
    }
    const spaces = /^ */.exec(line.text)?.[0].length ?? 0;
    const remove = Math.min(spaces, -width);
    if (remove > 0) changes.push({ from, to: from + remove });
  }
  return changes;
}

/**
 * The start that one list of the new document keeps.
 *
 * `starts` holds the start of every list of the old document that the edit
 * touched, by the position it maps to in the new document.
 */
function startOf(
  state: EditorState,
  list: SyntaxNode,
  changed: readonly Changed[],
  starts: ReadonlyMap<number, number>,
): number | null {
  const first = itemsOf(list)[0];
  if (first === undefined) return null;
  const number = numberOf(state, first);
  if (number === null) return null;
  const markTo = number.from + number.digits.length;
  const wroteTheStart = changed.some(
    (range) => range.fromB < markTo && range.toB > number.from,
  );
  if (wroteTheStart) return Number.parseInt(number.digits, 10);
  const kept = starts.get(list.from);
  if (kept !== undefined) return kept;
  if (list.parent?.name === 'ListItem') return 1;
  return Number.parseInt(number.digits, 10);
}

/**
 * The changes that put every touched ordered list back in sequence.
 *
 * The positions are those of the document after the transaction, so the
 * caller appends them to it as a sequential change.
 */
export function renumberChanges(
  transaction: Transaction,
): readonly ChangeSpec[] {
  if (!transaction.docChanged || !isEditOfAPerson(transaction)) return [];
  const changed = changedRanges(transaction);
  if (!changed.some((range) => canRenumber(transaction, range))) return [];

  const state = transaction.state;
  const doc = state.doc;
  const reach = Math.max(...changed.map((range) => range.toB));
  const tree = treeTo(state, withLinesAround(state, reach, reach).to);
  if (tree === null) return [];
  const oldState = transaction.startState;
  const oldReach = Math.max(...changed.map((range) => range.toA));
  const oldTree =
    treeTo(oldState, withLinesAround(oldState, oldReach, oldReach).to) ??
    syntaxTree(oldState);

  const lists = new Map<number, SyntaxNode>();
  for (const range of changed) {
    const around = withLinesAround(state, range.fromB, range.toB);
    orderedListsAround(tree, around.from, around.to, lists);
  }
  if (lists.size === 0) return [];

  const oldLists = new Map<number, SyntaxNode>();
  for (const range of changed) {
    const around = withLinesAround(oldState, range.fromA, range.toA);
    orderedListsAround(oldTree, around.from, around.to, oldLists);
  }
  const starts = new Map<number, number>();
  for (const old of oldLists.values()) {
    const first = itemsOf(old)[0];
    const number = first === undefined ? null : numberOf(oldState, first);
    if (number === null) continue;
    starts.set(
      transaction.changes.mapPos(old.from, 1),
      Number.parseInt(number.digits, 10),
    );
  }

  const changes: ChangeSpec[] = [];
  const shifts = new Map<number, number>();
  for (const list of lists.values()) {
    const start = startOf(state, list, changed, starts);
    if (start === null) continue;
    itemsOf(list).forEach((item, index) => {
      const number = numberOf(state, item);
      if (number === null) return;
      const digits = String(start + index);
      if (Number.parseInt(number.digits, 10) === start + index) return;
      changes.push({
        from: number.from,
        to: number.from + number.digits.length,
        insert: digits,
      });
      addItemShift(doc, item, digits.length - number.digits.length, shifts);
    });
  }

  changes.push(...lineShiftChanges(doc, shifts));
  return changes;
}

/** Appends the renumber of one edit to the edit itself. */
function renumberFilter(
  transaction: Transaction,
): TransactionSpec | readonly TransactionSpec[] {
  const changes = renumberChanges(transaction);
  if (changes.length === 0) return transaction;
  return [transaction, { changes, sequential: true }];
}

/** The extension that keeps every touched ordered list in sequence. */
export function orderedListNumbering(): Extension {
  return EditorState.transactionFilter.of(renumberFilter);
}
