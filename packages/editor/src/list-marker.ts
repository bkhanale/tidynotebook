/**
 * The marker of one list line, from the syntax tree, and the caret rule of
 * the markers that are drawn at every caret (record 0132).
 *
 * A bullet and a task box are drawn on the line whatever the caret does, the
 * way Notion and Obsidian draw them. The source before the item text is
 * therefore no place a person can see, so a caret never rests there: a caret
 * that a move puts in it rests on the first character of the text, and a step
 * backward from that character goes to the end of the line above. Home at that
 * character stays there. A range may still end in it, so the marker stays
 * selectable and editable as text.
 *
 * The live preview reads the same marker to draw the line, so the part that is
 * drawn and the part that holds no caret are one range.
 */
import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  EditorState,
  Prec,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/** Where the marker of one list item stands on its first line. */
export type ListMarker = {
  /** The start of the line that carries the marker. */
  readonly lineFrom: number;
  /** The bullet or the number with its delimiter. */
  readonly markFrom: number;
  readonly markTo: number;
  /** The task box, or null for an item with no box. */
  readonly task: { readonly from: number; readonly to: number } | null;
  /** Whether the bullet counts items. */
  readonly ordered: boolean;
  /** The first character of the item text, after the marker and its gap. */
  readonly contentFrom: number;
};

/** The marker of one `ListItem` node, or null when its line holds none. */
export function listMarkerOf(
  state: EditorState,
  item: SyntaxNode,
): ListMarker | null {
  const mark = item.getChild('ListMark');
  if (mark === null) return null;
  const doc = state.doc;
  const line = doc.lineAt(mark.from);
  const box = item.getChild('Task')?.getChild('TaskMarker') ?? null;
  const end = box !== null ? box.to : mark.to;
  if (end > line.to) return null;
  let contentFrom = end;
  while (
    contentFrom < line.to &&
    /[ \t]/.test(doc.sliceString(contentFrom, contentFrom + 1))
  )
    contentFrom += 1;
  return {
    lineFrom: line.from,
    markFrom: mark.from,
    markTo: mark.to,
    task: box === null ? null : { from: box.from, to: box.to },
    ordered: item.parent?.name === 'OrderedList',
    contentFrom,
  };
}

/**
 * The marker of the list item whose text starts on the line of `pos`.
 *
 * A line can open more than one item, as in `- - text`, and the text belongs
 * to the innermost one, so the last marker on the line wins.
 */
export function listMarkerOnLine(
  state: EditorState,
  pos: number,
): ListMarker | null {
  const line = state.doc.lineAt(pos);
  let found: ListMarker | null = null;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name !== 'ListItem') return true;
      if (node.from > line.to) return false;
      const marker = listMarkerOf(state, node.node);
      if (marker !== null && marker.lineFrom === line.from) found = marker;
      return true;
    },
  });
  return found;
}

/**
 * Whether the live preview draws a marker at every caret (record 0132).
 *
 * A task box always is, whatever list holds it. A bullet is. An ordered
 * number is text a person edits, so it keeps record 0092 and a caret reaches
 * it.
 */
export function drawnAtEveryCaret(marker: ListMarker): boolean {
  return marker.task !== null || !marker.ordered;
}

/**
 * Whether a selection shows the source of a drawn marker.
 *
 * Only a range does, and only when it covers a character of the marker or of
 * the gap after it. A caret never does, so the box stays a box while a person
 * writes the item.
 */
export function selectionShowsMarker(
  marker: ListMarker,
  selection: { readonly from: number; readonly to: number },
): boolean {
  return (
    selection.from < selection.to &&
    selection.from < marker.contentFrom &&
    selection.to > marker.markFrom
  );
}

/**
 * Where a caret goes that a move put at `pos`, from a caret at `from`.
 *
 * A caret outside the prefix of a drawn marker stays. A caret inside it rests
 * on the first character of the item text. The one exception is a move
 * backward out of that character, which goes to the end of the line above, so
 * the left arrow and a step by word leave the item as they leave a block in
 * Notion and a key never meets a place it cannot pass. A pointer never steps:
 * a tap beside a box means the text of the item. Home is the one backward move
 * that means this line, so `stayAtTextStart` answers it before it moves.
 */
export function markerCaret(
  state: EditorState,
  pos: number,
  from: number,
  pointer: boolean,
): number {
  const marker = listMarkerOnLine(state, pos);
  if (marker === null || !drawnAtEveryCaret(marker)) return pos;
  if (pos < marker.lineFrom || pos >= marker.contentFrom) return pos;
  if (!pointer && from === marker.contentFrom && marker.lineFrom > 0)
    return marker.lineFrom - 1;
  return marker.contentFrom;
}

/** Holds each caret that a person moves out of a drawn marker. */
function markerCaretFilter(
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
    const place = markerCaret(transaction.state, range.head, from, pointer);
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
 * Home at the first character of the text of a drawn marker, which stays.
 *
 * Home means the start of this line, and for such a line that is the start of
 * its text. Without this answer Home moved into the marker, which reads as a
 * move out of the text, and the caret left for the line above.
 */
export function stayAtTextStart(target: {
  readonly state: EditorState;
}): boolean {
  const state = target.state;
  return state.selection.ranges.every((range) => {
    if (!range.empty) return false;
    const marker = listMarkerOnLine(state, range.head);
    return (
      marker !== null &&
      drawnAtEveryCaret(marker) &&
      range.head === marker.contentFrom
    );
  });
}

/** The caret rule of the drawn list markers (record 0132). */
export function listMarkerCaret(): Extension {
  return [
    EditorState.transactionFilter.of(markerCaretFilter),
    // Above the default keymap, which moves Home to the start of the line.
    Prec.high(
      keymap.of([
        { key: 'Home', run: stayAtTextStart },
        { mac: 'Cmd-ArrowLeft', run: stayAtTextStart },
      ]),
    ),
  ];
}
