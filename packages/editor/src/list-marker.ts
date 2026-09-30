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
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/** The class of the shell of a task box, which owns its own events. */
export const taskBoxClassName = 'cm-np-task-box';

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
 * A task box always is, whatever list holds it. A bullet is once a space
 * follows it: CommonMark already reads a lone `-` as an empty item, but a
 * person who has typed only the `-` has not asked for a list yet, so it stays
 * the character they typed until the space arrives. An ordered number is text
 * a person edits, so it keeps record 0092 and a caret reaches it.
 */
export function drawnAtEveryCaret(marker: ListMarker): boolean {
  if (marker.task !== null) return true;
  return !marker.ordered && marker.contentFrom > marker.markTo;
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
  const marker = drawnPrefixAt(state, pos);
  if (marker === null || pos === marker.contentFrom) return pos;
  if (!pointer && from === marker.contentFrom && marker.lineFrom > 0)
    return marker.lineFrom - 1;
  return marker.contentFrom;
}

/**
 * The drawn marker whose prefix holds `pos`, or null.
 *
 * The prefix runs from the start of the line to the first character of the
 * text, both ends included, because a place at either end is a place beside
 * the drawn marker.
 */
export function drawnPrefixAt(
  state: EditorState,
  pos: number,
): ListMarker | null {
  const marker = listMarkerOnLine(state, pos);
  if (marker === null || !drawnAtEveryCaret(marker)) return null;
  if (pos < marker.lineFrom || pos > marker.contentFrom) return null;
  return marker;
}

/**
 * Takes a tap beside a drawn marker from the browser.
 *
 * On a touch screen the browser places the caret of a tap itself, and the
 * editor reads it afterwards. The filter above then moved a caret that the
 * browser had already drawn to the left of the box, so the caret showed there
 * and jumped. A tap whose place is in the prefix of a drawn marker is answered
 * here instead, before the browser acts: the caret goes to the first character
 * of the text, and the browser draws no caret of its own.
 *
 * A touch is a tap until the browser cancels its pointer, which it does when
 * the touch becomes a scroll or a long press of its own, so no distance or
 * time is guessed here.
 *
 * `place` names the document position of one tap on `element`, or null for a
 * tap this listener leaves to the browser. The returned function stops it.
 */
function followTaps(
  view: EditorView,
  element: HTMLElement,
  place: (event: TouchEvent, touch: Touch) => number | null,
): () => void {
  /** The touch pointer that can still end as a tap, or null. */
  let tap: number | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    tap =
      event.pointerType === 'touch' && event.isPrimary ? event.pointerId : null;
  };
  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === tap) tap = null;
  };
  const onTouchEnd = (event: TouchEvent): void => {
    const tapped = tap !== null;
    tap = null;
    const touch = event.changedTouches[0];
    if (
      !tapped ||
      !event.cancelable ||
      event.defaultPrevented ||
      event.touches.length > 0 ||
      event.changedTouches.length !== 1 ||
      touch === undefined
    )
      return;
    const pos = place(event, touch);
    if (pos === null) return;
    const marker = drawnPrefixAt(view.state, pos);
    if (marker === null) return;
    event.preventDefault();
    view.dispatch({
      selection: EditorSelection.cursor(marker.contentFrom),
      userEvent: 'select.pointer',
    });
    view.focus();
  };
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('touchend', onTouchEnd, { passive: false });
  return (): void => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('touchend', onTouchEnd);
  };
}

/**
 * The taps on the editor itself.
 *
 * The whole editor listens, and not only its text: a tap in the margin of the
 * scroller to the left of a bullet is outside the text, and the browser still
 * puts the caret of that tap at the start of the line. A control that stands
 * in the scroller, and the task box, which owns its own events, keep their
 * taps.
 */
const markerTap = ViewPlugin.define((view) => ({
  destroy: followTaps(view, view.dom, (event, touch) => {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    if (!view.contentDOM.contains(target) && target !== view.scrollDOM)
      return null;
    if (target.closest(`.${taskBoxClassName}`) !== null) return null;
    return view.posAtCoords({ x: touch.clientX, y: touch.clientY });
  }),
}));

/**
 * Takes the taps on the page margin to the left of the editor (record 0132).
 *
 * The page that holds the editor keeps a margin between the edge of the
 * screen and the text, and that margin is outside the editor, so a tap on it
 * never reached `markerTap`. The browser still placed its own caret at the
 * start of the nearest line, left of a task box. The page names its margin
 * here, and a tap on the margin itself, beside a line of the editor, counts
 * as a tap at the start of that line. A tap on anything that stands in the
 * margin keeps its own meaning. The returned function stops it.
 */
export function takeMarginTaps(
  view: EditorView,
  margin: HTMLElement,
): () => void {
  return followTaps(view, margin, (event, touch) => {
    if (event.target !== margin) return null;
    const box = view.scrollDOM.getBoundingClientRect();
    if (touch.clientX >= box.left) return null;
    if (touch.clientY < box.top || touch.clientY > box.bottom) return null;
    return view.posAtCoords({ x: box.left, y: touch.clientY }, false);
  });
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
  return state.selection.ranges.every(
    (range) =>
      range.empty &&
      drawnPrefixAt(state, range.head)?.contentFrom === range.head,
  );
}

/** The caret rule of the drawn list markers (record 0132). */
export function listMarkerCaret(): Extension {
  return [
    EditorState.transactionFilter.of(markerCaretFilter),
    markerTap,
    // Above the default keymap, which moves Home to the start of the line.
    Prec.high(
      keymap.of([
        { key: 'Home', run: stayAtTextStart },
        { mac: 'Cmd-ArrowLeft', run: stayAtTextStart },
      ]),
    ),
  ];
}
