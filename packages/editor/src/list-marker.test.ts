/**
 * The caret rule of the drawn list markers (record 0132).
 *
 * Each case builds a state with the note language and the caret filter, moves
 * the caret the way a key or a tap does, and reads where it rests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import { noteMarkdown, parsedWhole } from './language.ts';
import {
  drawnPrefixAt,
  listMarkerCaret,
  listMarkerOnLine,
  selectionShowsMarker,
  stayAtTextStart,
} from './list-marker.ts';

/** A parsed state with the caret filter and a caret at `caret`. */
function stateOf(doc: string, caret: number): EditorState {
  return parsedWhole(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [noteMarkdown(), listMarkerCaret()],
    }),
  );
}

/** Where the caret rests after a move from `from` to `to`. */
function moved(
  doc: string,
  from: number,
  to: number,
  userEvent: string = 'select',
): number {
  const state = stateOf(doc, from);
  return state.update({ selection: EditorSelection.cursor(to), userEvent })
    .state.selection.main.head;
}

await test('a tap on the marker of a task puts the caret on its text', () => {
  // The defect this covers: a tap beside the box on a phone put the caret to
  // the left of the box, where nothing can be written.
  const doc = 'a\n- [ ] one\n';
  for (let pos = 2; pos < 8; pos += 1)
    assert.equal(
      moved(doc, 0, pos, 'select.pointer'),
      8,
      `a tap at ${String(pos)} left the caret in the marker`,
    );
  assert.equal(moved(doc, 0, 8, 'select.pointer'), 8);
  assert.equal(moved(doc, 0, 10, 'select.pointer'), 10);
});

await test('a tap on a bullet puts the caret on its text', () => {
  assert.equal(moved('- one\n', 6, 0, 'select.pointer'), 2);
  assert.equal(moved('- one\n', 6, 1, 'select.pointer'), 2);
});

await test('a step back from the text of an item leaves for the line above', () => {
  // The left arrow and a step by word at the first character of the text
  // leave the item, as they leave a block in Notion, so no key is stuck.
  const doc = 'a\n- [ ] one\n';
  assert.equal(moved(doc, 8, 7), 1);
  assert.equal(moved(doc, 8, 2), 1);
  // A tap never steps, whatever the caret did before it.
  assert.equal(moved(doc, 8, 7, 'select.pointer'), 8);
});

await test('Home at the start of the text stays there', () => {
  const doc = 'a\n- [ ] one\n';
  assert.equal(stayAtTextStart({ state: stateOf(doc, 8) }), true);
  // Anywhere else Home moves as it always does, and the filter above holds
  // where it lands.
  assert.equal(stayAtTextStart({ state: stateOf(doc, 10) }), false);
  assert.equal(stayAtTextStart({ state: stateOf(doc, 1) }), false);
  assert.equal(stayAtTextStart({ state: stateOf('1. one\n', 3) }), false);
});

await test('a step back on the first line keeps the caret on the text', () => {
  assert.equal(moved('- [ ] one\n', 6, 5), 6);
});

await test('a move into the marker from elsewhere rests on the text', () => {
  const doc = 'a\n- [ ] one\nbelow\n';
  // The right arrow from the end of the line above.
  assert.equal(moved(doc, 1, 2), 8);
  // An arrow up from the line below, at a small column.
  assert.equal(moved(doc, 13, 3), 8);
  // Home from inside the text goes to the start of the text.
  assert.equal(moved(doc, 10, 2), 8);
});

await test('a nested task, a quoted bullet and a line of two markers', () => {
  const nested = '- one\n  - [ ] two\n';
  assert.equal(moved(nested, 0, 6, 'select.pointer'), 14);
  assert.equal(moved(nested, 0, 8, 'select.pointer'), 14);
  assert.equal(moved('> - one\n', 7, 0, 'select.pointer'), 4);
  // The text of `- - x` belongs to the inner item.
  assert.equal(moved('- - x\n', 5, 2, 'select.pointer'), 4);
});

await test('an ordered item keeps its caret places (record 0092)', () => {
  assert.equal(moved('1. one\n', 6, 0, 'select.pointer'), 0);
  assert.equal(moved('1. one\n', 6, 1), 1);
  // A task in an ordered list is still a box.
  assert.equal(moved('1. [ ] one\n', 10, 0, 'select.pointer'), 7);
});

await test('a range may end in the marker, so the marker stays selectable', () => {
  const doc = 'a\n- [ ] one\n';
  const state = stateOf(doc, 11);
  const next = state.update({
    selection: EditorSelection.range(11, 2),
    userEvent: 'select',
  }).state;
  assert.deepEqual(
    [next.selection.main.anchor, next.selection.main.head],
    [11, 2],
  );
});

await test('a change that is not a move keeps its caret', () => {
  // A command that places the caret states where it goes. Only a move of a
  // person is held.
  const state = stateOf('- one\n', 6);
  assert.equal(
    state.update({ selection: EditorSelection.cursor(0) }).state.selection.main
      .head,
    0,
  );
});

await test('only a range over the marker shows the marker', () => {
  const state = stateOf('a\n- [ ] one\n', 0);
  const marker = listMarkerOnLine(state, 8);
  assert.ok(marker !== null);
  assert.deepEqual(
    [marker.lineFrom, marker.markFrom, marker.contentFrom],
    [2, 2, 8],
  );
  assert.equal(selectionShowsMarker(marker, { from: 5, to: 5 }), false);
  assert.equal(selectionShowsMarker(marker, { from: 8, to: 11 }), false);
  // A selection of the line above with its line break stops at the marker.
  assert.equal(selectionShowsMarker(marker, { from: 0, to: 2 }), false);
  assert.equal(selectionShowsMarker(marker, { from: 7, to: 11 }), true);
  assert.equal(selectionShowsMarker(marker, { from: 0, to: 11 }), true);
});

await test('a lone bullet is the character typed until its space', () => {
  // The defect this covers: `-` became a dot before the space that asks for
  // a list, and the caret could not stand before it.
  assert.equal(moved('-\n', 1, 0, 'select.pointer'), 0);
  assert.equal(drawnPrefixAt(stateOf('-\n', 1), 0), null);
  assert.equal(moved('- \n', 2, 0, 'select.pointer'), 2);
});

await test('the prefix that a tap hands to the text holds both its ends', () => {
  const state = stateOf('a\n- [ ] one\n', 0);
  for (const pos of [2, 5, 8])
    assert.equal(drawnPrefixAt(state, pos)?.contentFrom, 8);
  // The text itself, the line above and an ordered number are no prefix.
  assert.equal(drawnPrefixAt(state, 9), null);
  assert.equal(drawnPrefixAt(state, 1), null);
  assert.equal(drawnPrefixAt(stateOf('1. one\n', 0), 0), null);
});
