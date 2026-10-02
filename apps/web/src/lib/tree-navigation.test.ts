import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNoteTree, type NoteSummary } from './note-list.ts';
import {
  focusAfterRemoval,
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

await test('the focus goes to the next row after a move to Trash', () => {
  // The review of the merged branch: the focus went to the page after a
  // move to Trash from the keys.
  const order = ['folder:Work', 'note:b', 'note:a', 'note:c'];
  assert.equal(focusAfterRemoval(order, ['note:b', 'note:a']), 'note:c');
  assert.equal(focusAfterRemoval(order, ['note:c']), 'note:a');
  assert.equal(focusAfterRemoval(order, order), null);
  assert.equal(focusAfterRemoval(order, []), null);
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
