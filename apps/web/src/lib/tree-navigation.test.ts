import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNoteTree, type NoteSummary } from './note-list.ts';
import {
  isFieldKey,
  placeAfterChange,
  rowKeyOf,
  treeKeyAction,
} from './tree-navigation.ts';
import { actionableKeys, visibleTreeRows } from './tree-rows.ts';

const note = (fileId: string, path: string): NoteSummary => ({
  fileId,
  path,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  localOnly: false,
  unsent: false,
});

const tree = buildNoteTree([
  note('a', 'Work/Plan.md'),
  note('b', 'Work/Budget.md'),
  note('c', 'Ideas.md'),
]);
const open = visibleTreeRows(tree, new Set(['Work']));
const closed = visibleTreeRows(tree, new Set());

/** The context of the tree with the focus on one row. */
const at = (key: string, rows = open, selecting = false) => ({
  rows,
  order: actionableKeys(rows),
  key,
  selecting,
});

await test('the arrows walk the rows from the row that has the focus', () => {
  assert.deepEqual(treeKeyAction('next', at('folder:Work')), {
    kind: 'focus',
    key: 'note:b',
  });
  assert.deepEqual(treeKeyAction('previous', at('note:b')), {
    kind: 'focus',
    key: 'folder:Work',
  });
  assert.deepEqual(treeKeyAction('next', at('note:c')), { kind: 'none' });
  assert.deepEqual(treeKeyAction('last', at('folder:Work')), {
    kind: 'focus',
    key: 'note:c',
  });
});

await test('Right opens a folder, then goes into it; Left closes it, then goes up', () => {
  assert.deepEqual(treeKeyAction('expand', at('folder:Work', closed)), {
    kind: 'toggle-folder',
    path: 'Work',
  });
  assert.deepEqual(treeKeyAction('expand', at('folder:Work')), {
    kind: 'focus',
    key: 'note:b',
  });
  assert.deepEqual(treeKeyAction('collapse', at('folder:Work')), {
    kind: 'toggle-folder',
    path: 'Work',
  });
  assert.deepEqual(treeKeyAction('collapse', at('note:a')), {
    kind: 'focus',
    key: 'folder:Work',
  });
});

await test('Enter opens a note and selects a folder', () => {
  assert.deepEqual(treeKeyAction('activate', at('note:c')), {
    kind: 'open-note',
    fileId: 'c',
  });
  assert.deepEqual(treeKeyAction('activate', at('folder:Work')), {
    kind: 'select-folder',
    path: 'Work',
  });
});

await test('Shift with an arrow extends from the row that has the focus', () => {
  assert.deepEqual(treeKeyAction('extend-next', at('note:b')), {
    kind: 'extend',
    to: 'note:a',
    from: 'note:b',
  });
});

await test('Escape clears a selection and leaves the key to the drawer otherwise', () => {
  assert.deepEqual(treeKeyAction('clear', at('note:b', open, true)), {
    kind: 'clear',
  });
  assert.deepEqual(treeKeyAction('clear', at('note:b')), { kind: 'none' });
});

await test('F2, the menu keys and Delete act on the row that has the focus', () => {
  assert.deepEqual(treeKeyAction('rename', at('note:a')), {
    kind: 'rename',
    key: 'note:a',
  });
  assert.deepEqual(treeKeyAction('menu', at('note:a')), {
    kind: 'menu',
    key: 'note:a',
  });
  assert.deepEqual(treeKeyAction('trash', at('note:a')), {
    kind: 'trash',
    key: 'note:a',
  });
  assert.deepEqual(treeKeyAction('next', at('note:gone')), { kind: 'none' });
});

await test('the focus goes to the next row that stays when its row leaves', () => {
  // The review of the merged branch: the focus went to the page after a
  // move to Trash from the keys. The second review: it still went there after
  // a move to Trash from the menu of a row, or a move into a closed folder.
  const previous = ['folder:Work', 'note:b', 'note:a', 'note:c'];
  const without = (...gone: string[]): string[] =>
    previous.filter((key) => !gone.includes(key));
  assert.deepEqual(
    placeAfterChange({
      previous,
      current: without('note:b', 'note:a'),
      key: 'note:b',
      focusFell: true,
    }),
    { key: 'note:c', focus: true },
  );
  // The last row gives its place to the row before it.
  assert.deepEqual(
    placeAfterChange({
      previous,
      current: without('note:c'),
      key: 'note:c',
      focusFell: true,
    }),
    { key: 'note:a', focus: true },
  );
  // A folder that leaves with its open rows gives its place past them.
  assert.deepEqual(
    placeAfterChange({
      previous: ['folder:Work', 'note:w1', 'note:w2', 'note:z'],
      current: ['note:z'],
      key: 'folder:Work',
      focusFell: true,
    }),
    { key: 'note:z', focus: true },
  );
  assert.deepEqual(
    placeAfterChange({ previous, current: [], key: 'note:a', focusFell: true }),
    { key: null, focus: false },
  );
});

await test('a row that leaves while the focus is elsewhere moves the place only', () => {
  const previous = ['note:a', 'note:b'];
  assert.deepEqual(
    placeAfterChange({
      previous,
      current: ['note:b'],
      key: 'note:a',
      focusFell: false,
    }),
    { key: 'note:b', focus: false },
  );
});

await test('a row that stays keeps the place, and takes back a focus that fell', () => {
  const previous = ['note:a', 'note:b'];
  assert.deepEqual(
    placeAfterChange({
      previous,
      current: previous,
      key: 'note:a',
      focusFell: false,
    }),
    { key: 'note:a', focus: false },
  );
  assert.deepEqual(
    placeAfterChange({
      previous,
      current: ['note:b', 'note:a'],
      key: 'note:a',
      focusFell: true,
    }),
    { key: 'note:a', focus: true },
  );
  assert.deepEqual(
    placeAfterChange({
      previous,
      current: previous,
      key: null,
      focusFell: true,
    }),
    { key: null, focus: false },
  );
});

await test('a place the tree did not show yet stays, such as a renamed folder', () => {
  assert.deepEqual(
    placeAfterChange({
      previous: ['folder:Old', 'note:a'],
      current: ['folder:Old', 'note:a'],
      key: 'folder:New',
      focusFell: false,
    }),
    { key: 'folder:New', focus: false },
  );
});

await test('a key in a field of a row belongs to the field', () => {
  // The second review: a refused rename stopped every key of the tree.
  const inField = {
    closest: (selector: string) =>
      selector.split(', ').includes('input') ? {} : null,
  };
  const onRow = { closest: () => null };
  assert.equal(isFieldKey(inField), true);
  assert.equal(isFieldKey(onRow), false);
  assert.equal(isFieldKey(null), false);
});

await test('the row of an element is read from the element', () => {
  // The review of the merged branch: a key after a click on a chevron acted
  // on the row that had the focus before the click.
  const chevron = {
    closest: (selector: string) =>
      selector === '[data-row-key]'
        ? {
            getAttribute: (name: string) =>
              name === 'data-row-key' ? 'folder:Work' : null,
          }
        : null,
  };
  assert.equal(rowKeyOf(chevron), 'folder:Work');
  assert.equal(rowKeyOf({ closest: () => null }), null);
  assert.equal(rowKeyOf(null), null);
});
