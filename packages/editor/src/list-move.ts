/**
 * Moves one list item among the items of its list (record 0106).
 *
 * The grip of `list-controls.ts`, the two tools of the formatting row, the
 * palette and Alt with the arrow keys all run this one rule, so every road
 * moves an item the same way.
 *
 * The rules that shape this module:
 *
 * - The items come from the Lezer tree, like every decoration, so an item
 *   holds its later lines and its nested lists as a reader sees them.
 * - An item moves among its siblings only. It keeps its level and its list.
 * - A move is two changes of one transaction: the item and the gap beside it
 *   leave, and they enter at the new place. The other items keep their text,
 *   so the work of another device on them merges as before (record 0082).
 * - A moved ordered item takes the number of the place where it lands, so a
 *   list keeps its start. The renumber of record 0089 then sets the other
 *   numbers in the same transaction.
 */
import { syntaxTree } from '@codemirror/language';
import {
  ChangeSet,
  EditorSelection,
  Text,
  type ChangeSpec,
  type EditorState,
  type TransactionSpec,
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { addItemShift, lineShiftChanges, numberOf } from './list-numbering.ts';

/**
 * One item of a list.
 *
 * `from` is the start of its marker and `to` is the end of its last line, so
 * the text between two items is the line break, the blank lines and the
 * indentation of the next marker.
 */
export type ListItemSpan = {
  readonly from: number;
  readonly to: number;
  readonly node: SyntaxNode;
};

/** The items of one list and the place of one of them. */
export type ListItemPlace = {
  readonly items: readonly ListItemSpan[];
  readonly index: number;
};

/** Where the caret stands for the two move tools of the formatting row. */
export type ListMoveContext = {
  readonly itemUp: boolean;
  readonly itemDown: boolean;
};

/** The move context of a caret outside every list item. */
export const outsideListItem: ListMoveContext = {
  itemUp: false,
  itemDown: false,
};

/**
 * Whether the marker of an item starts its line.
 *
 * Only spaces and the marks of a quote may stand before it. An item that
 * starts after the marker of another item, as the inner item of `- - a`
 * does, shares its line with that item and cannot move alone.
 */
function startsItsLine(state: EditorState, node: SyntaxNode): boolean {
  const line = state.doc.lineAt(node.from);
  return /^[ \t>]*$/.test(state.doc.sliceString(line.from, node.from));
}

/** One item as a span of the document. */
function spanOf(state: EditorState, node: SyntaxNode): ListItemSpan {
  return { from: node.from, to: state.doc.lineAt(node.to).to, node };
}

/**
 * The innermost item that holds the line of `pos`, with its siblings, or
 * `null` when the line is in no item or its list cannot move.
 */
export function listItemAt(
  state: EditorState,
  pos: number,
): ListItemPlace | null {
  const line = state.doc.lineAt(pos);
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name !== 'ListItem') return;
      if (found === null || node.from > found.from) found = node.node;
    },
  });
  if (found === null) return null;
  const item: SyntaxNode = found;
  const list = item.parent;
  if (list === null) return null;
  const nodes = list.getChildren('ListItem');
  if (!nodes.every((node) => startsItsLine(state, node))) return null;
  const items = nodes.map((node) => spanOf(state, node));
  const index = items.findIndex((span) => span.from === item.from);
  if (index === -1) return null;
  return { items, index };
}

/**
 * The item that holds the whole main selection, or `null`.
 *
 * A selection over more than one item is a selection of lines, so the
 * commands leave it to the line move of CodeMirror.
 */
function selectedItem(state: EditorState): ListItemPlace | null {
  const range = state.selection.main;
  const place = listItemAt(state, range.head);
  if (place === null) return null;
  const item = place.items[place.index];
  if (item === undefined) return null;
  const start = state.doc.lineAt(item.from).from;
  return range.from >= start && range.to <= item.to ? place : null;
}

/**
 * The text of an item, with the number of the place where it lands.
 *
 * A number that grows or shrinks moves the later lines of the item by the
 * same width, by the one line rule of `list-numbering.ts`.
 */
function landedText(
  state: EditorState,
  item: ListItemSpan,
  target: ListItemSpan,
): { readonly text: string; readonly local: ChangeSet } {
  const doc = state.doc;
  const text = doc.sliceString(item.from, item.to);
  const own = numberOf(state, item.node);
  const landing = numberOf(state, target.node);
  const specs: ChangeSpec[] = [];
  if (own !== null && landing !== null && own.digits !== landing.digits) {
    specs.push({
      from: own.from - item.from,
      to: own.from - item.from + own.digits.length,
      insert: landing.digits,
    });
    const shifts = new Map<number, number>();
    addItemShift(
      doc,
      item.node,
      landing.digits.length - own.digits.length,
      shifts,
    );
    const moved = ChangeSet.of(lineShiftChanges(doc, shifts), doc.length);
    moved.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      specs.push({
        from: fromA - item.from,
        to: toA - item.from,
        insert: inserted.toString(),
      });
    });
  }
  const local = ChangeSet.of(specs, text.length);
  return {
    text: local.apply(Text.of(text.split('\n'))).toString(),
    local,
  };
}

/**
 * The transaction that moves the item at the line of `pos` to place `to` of
 * its list, or `null` when it cannot move there.
 *
 * `to` is the place that the item takes among its siblings after the move.
 * A caret inside the item stays at the same place in its text, and every
 * other range follows the text around it.
 */
export function moveListItemSpec(
  state: EditorState,
  pos: number,
  to: number,
): TransactionSpec | null {
  const place = listItemAt(state, pos);
  if (place === null) return null;
  const { items, index } = place;
  const item = items[index];
  const target = items[to];
  if (item === undefined || target === undefined || to === index) return null;
  const doc = state.doc;
  const landed = landedText(state, item, target);
  let changes: ChangeSpec[];
  let start: number;
  if (to < index) {
    // The item and the gap above it leave, and they enter above the target.
    const above = items[index - 1];
    if (above === undefined) return null;
    const gap = doc.sliceString(above.to, item.from);
    changes = [
      { from: target.from, insert: landed.text + gap },
      { from: above.to, to: item.to },
    ];
    start = target.from;
  } else {
    // The item and the gap below it leave, and they enter below the target.
    const below = items[index + 1];
    if (below === undefined) return null;
    const gap = doc.sliceString(item.to, below.from);
    changes = [
      { from: item.from, to: below.from },
      { from: target.to, insert: gap + landed.text },
    ];
    start = target.to - (below.from - item.from) + gap.length;
  }
  const set = state.changes(changes);
  // A range at the edge where the item enters stays with the text it was on.
  const assoc = to < index ? 1 : -1;
  const placeOf = (at: number): number =>
    at >= item.from && at <= item.to
      ? start + landed.local.mapPos(at - item.from)
      : set.mapPos(at, assoc);
  const ranges = state.selection.ranges.map((range) =>
    EditorSelection.range(placeOf(range.anchor), placeOf(range.head)),
  );
  return {
    changes: set,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
  };
}

/** The transaction that moves the item of the caret one place up. */
export function moveListItemUpSpec(state: EditorState): TransactionSpec | null {
  const place = selectedItem(state);
  if (place === null) return null;
  return moveListItemSpec(state, state.selection.main.head, place.index - 1);
}

/** The transaction that moves the item of the caret one place down. */
export function moveListItemDownSpec(
  state: EditorState,
): TransactionSpec | null {
  const place = selectedItem(state);
  if (place === null) return null;
  return moveListItemSpec(state, state.selection.main.head, place.index + 1);
}

/** Whether the item of the caret can move up and down. */
export function listMoveContextOf(state: EditorState): ListMoveContext {
  const place = selectedItem(state);
  if (place === null) return outsideListItem;
  return {
    itemUp: place.index > 0,
    itemDown: place.index < place.items.length - 1,
  };
}

/** Whether the caret stands in an item that the move commands own. */
export function inMovableListItem(state: EditorState): boolean {
  return selectedItem(state) !== null;
}
