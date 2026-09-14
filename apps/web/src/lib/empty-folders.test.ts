import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parentFolders,
  pruneEmptyFolders,
  removeEmptyFolders,
  rewriteEmptyFolders,
} from './empty-folders.ts';

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

await test('removeEmptyFolders keeps the folder above the one that goes', () => {
  // A parent that only its one child folder made visible must stay in the
  // tree. A delete takes the folder the person named and nothing above it.
  assert.deepEqual(removeEmptyFolders(['Work/Plans'], 'Work/Plans'), ['Work']);
});

await test('removeEmptyFolders keeps every level above a deep folder', () => {
  assert.deepEqual(removeEmptyFolders(['Work/Plans/2026'], 'Work/Plans/2026'), [
    'Work',
    'Work/Plans',
  ]);
});

await test('removeEmptyFolders keeps the parent of a folder that held notes', () => {
  // The notes under `Work/Plans` described `Work` as well. They are in the
  // trash now, so `Work` is remembered here instead.
  assert.deepEqual(
    pruneEmptyFolders(removeEmptyFolders([], 'Work/Plans'), []),
    ['Work'],
  );
});

await test('a parent that still holds a note is not listed as empty', () => {
  assert.deepEqual(
    pruneEmptyFolders(removeEmptyFolders([], 'Work/Plans'), ['Work/Note.md']),
    [],
  );
});

await test('rewriteEmptyFolders keeps the folder a move came out of', () => {
  assert.deepEqual(rewriteEmptyFolders(['Work/Plans'], 'Work/Plans', 'Plans'), [
    'Plans',
    'Work',
  ]);
});

await test('parentFolders lists every level, outermost first', () => {
  assert.deepEqual(parentFolders('Work/Plans/2026'), ['Work', 'Work/Plans']);
  assert.deepEqual(parentFolders('Work'), []);
  assert.deepEqual(parentFolders(''), []);
});
