import assert from 'node:assert/strict';
import test from 'node:test';
import { removeEmptyFolders } from './empty-folders.ts';

await test('removeEmptyFolders removes the folder and its descendants', () => {
  assert.deepEqual(
    removeEmptyFolders(
      ['Work', 'Work/Plans', 'Work/Plans/2026', 'Notes'],
      'Work',
    ),
    ['Notes'],
  );
});

await test('removeEmptyFolders keeps a sibling folder', () => {
  assert.deepEqual(
    removeEmptyFolders(['Work', 'Personal', 'Personal/Ideas'], 'Work'),
    ['Personal', 'Personal/Ideas'],
  );
});

await test('removeEmptyFolders keeps Workshop when Work is removed', () => {
  assert.deepEqual(
    removeEmptyFolders(['Work', 'Workshop', 'Workshop/Deep'], 'Work'),
    ['Workshop', 'Workshop/Deep'],
  );
});

await test('removeEmptyFolders leaves the empty folder argument alone', () => {
  const remembered = ['Work', 'Work/Plans', 'Personal'];
  assert.deepEqual(removeEmptyFolders(remembered, ''), remembered);
});
