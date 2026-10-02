import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionTargets,
  emptySelection,
  isRowSelected,
  keepVisible,
  selectAll,
  selectRange,
  toggleRow,
} from './tree-selection.ts';

const order = ['folder:A', 'note:1', 'note:2', 'note:3', 'note:4'];

/** The keys of a selection, in a fixed order. */
const keysOf = (selection: { readonly keys: ReadonlySet<string> }) =>
  [...selection.keys].sort();

await test('a second Ctrl click selects two rows', () => {
  // Issue 255: no selection held more than one row.
  const one = toggleRow(emptySelection, 'note:3', 'note:1');
  assert.deepEqual(keysOf(one), ['note:1', 'note:3']);
  assert.equal(one.anchor, 'note:3');
  const two = toggleRow(one, 'note:4');
  assert.deepEqual(keysOf(two), ['note:1', 'note:3', 'note:4']);
});

await test('a Ctrl click on a selected row takes it out', () => {
  const selection = toggleRow(toggleRow(emptySelection, 'note:1'), 'note:2');
  assert.deepEqual(keysOf(toggleRow(selection, 'note:1')), ['note:2']);
});

await test('Ctrl on the row a person stands on selects it alone', () => {
  assert.deepEqual(keysOf(toggleRow(emptySelection, 'note:2', 'note:2')), [
    'note:2',
  ]);
});

await test('Shift selects the rows from the anchor, in both directions', () => {
  const anchored = toggleRow(emptySelection, 'note:1');
  assert.deepEqual(keysOf(selectRange(anchored, order, 'note:3', null)), [
    'note:1',
    'note:2',
    'note:3',
  ]);
  assert.deepEqual(keysOf(selectRange(anchored, order, 'folder:A', null)), [
    'folder:A',
    'note:1',
  ]);
});

await test('Shift with no anchor starts at the row that had the focus', () => {
  const range = selectRange(emptySelection, order, 'note:3', 'note:2');
  assert.deepEqual(keysOf(range), ['note:2', 'note:3']);
  assert.equal(range.anchor, 'note:2');
  // The next step keeps the anchor and grows the range.
  assert.deepEqual(keysOf(selectRange(range, order, 'note:4', 'note:3')), [
    'note:2',
    'note:3',
    'note:4',
  ]);
});

await test('Ctrl and A selects every row', () => {
  assert.deepEqual(keysOf(selectAll(order)), [...order].sort());
});

await test('a row that leaves the screen leaves the selection', () => {
  const selection = selectAll(order);
  const kept = keepVisible(selection, ['folder:A', 'note:4']);
  assert.deepEqual(keysOf(kept), ['folder:A', 'note:4']);
  assert.equal(kept.anchor, 'folder:A');
  assert.equal(keepVisible(kept, ['folder:A', 'note:4']), kept);
  assert.equal(keepVisible(toggleRow(emptySelection, 'x'), order).anchor, null);
});

await test('a row of a selection acts for the set, in screen order', () => {
  const selection = toggleRow(toggleRow(emptySelection, 'note:3'), 'note:1');
  assert.deepEqual(actionTargets(selection, order, 'note:3'), [
    'note:1',
    'note:3',
  ]);
  // A row outside the set acts for itself alone.
  assert.deepEqual(actionTargets(selection, order, 'note:2'), ['note:2']);
  assert.deepEqual(actionTargets(emptySelection, order, 'note:2'), ['note:2']);
  assert.ok(isRowSelected(selection, 'note:1'));
  assert.ok(!isRowSelected(selection, 'note:2'));
});
