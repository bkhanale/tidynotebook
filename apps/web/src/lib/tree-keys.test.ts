import assert from 'node:assert/strict';
import test from 'node:test';
import { treeKeyIntent, type TreeKey } from './tree-keys.ts';

/** One key press with no modifier unless the case names one. */
function press(key: string, modifiers: Partial<TreeKey> = {}): TreeKey {
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
  };
}

await test('the arrows, Home and End move the focus', () => {
  assert.equal(treeKeyIntent(press('ArrowDown')), 'next');
  assert.equal(treeKeyIntent(press('ArrowUp')), 'previous');
  assert.equal(treeKeyIntent(press('Home')), 'first');
  assert.equal(treeKeyIntent(press('End')), 'last');
  assert.equal(treeKeyIntent(press('ArrowRight')), 'expand');
  assert.equal(treeKeyIntent(press('ArrowLeft')), 'collapse');
});

await test('Shift with an arrow extends the selection', () => {
  assert.equal(
    treeKeyIntent(press('ArrowDown', { shiftKey: true })),
    'extend-next',
  );
  assert.equal(
    treeKeyIntent(press('ArrowUp', { shiftKey: true })),
    'extend-previous',
  );
});

await test('F2 renames and Enter opens', () => {
  // Issue 255: no row renamed with F2.
  assert.equal(treeKeyIntent(press('F2')), 'rename');
  assert.equal(treeKeyIntent(press('Enter')), 'activate');
});

await test('Shift + F10 and the Menu key open the menu', () => {
  assert.equal(treeKeyIntent(press('F10', { shiftKey: true })), 'menu');
  assert.equal(treeKeyIntent(press('ContextMenu')), 'menu');
  assert.equal(treeKeyIntent(press('F10')), null);
});

await test('Space, Ctrl or Cmd and A, and Escape decide the selection', () => {
  assert.equal(treeKeyIntent(press(' ')), 'toggle-select');
  assert.equal(treeKeyIntent(press(' ', { ctrlKey: true })), 'toggle-select');
  assert.equal(treeKeyIntent(press('a', { ctrlKey: true })), 'select-all');
  assert.equal(treeKeyIntent(press('a', { metaKey: true })), 'select-all');
  assert.equal(treeKeyIntent(press('a')), null);
  assert.equal(treeKeyIntent(press('Escape')), 'clear');
});

await test('Delete, and Cmd + Backspace on a Mac, move to Trash', () => {
  assert.equal(treeKeyIntent(press('Delete')), 'trash');
  assert.equal(treeKeyIntent(press('Backspace', { metaKey: true })), 'trash');
  assert.equal(treeKeyIntent(press('Backspace')), null);
});

await test('a key the tree does not own is left alone', () => {
  assert.equal(treeKeyIntent(press('Tab')), null);
  assert.equal(treeKeyIntent(press('x')), null);
  assert.equal(treeKeyIntent(press('ArrowDown', { altKey: true })), null);
  assert.equal(treeKeyIntent(press('p', { ctrlKey: true })), null);
});
