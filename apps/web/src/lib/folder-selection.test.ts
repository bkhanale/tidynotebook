import assert from 'node:assert/strict';
import test from 'node:test';
import {
  childFolderPath,
  knownFolderPaths,
  selectedFolderOrRoot,
} from './folder-selection.ts';

await test('a child folder uses the selected full parent path', () => {
  assert.equal(childFolderPath('', 'Work'), 'Work');
  assert.equal(childFolderPath('Work/Plans', 'Next'), 'Work/Plans/Next');
});

await test('known folders include every parent of an empty folder', () => {
  assert.deepEqual(
    knownFolderPaths(['Work/Notes/One.md'], ['Archive/Old/Done']),
    ['Archive', 'Archive/Old', 'Archive/Old/Done', 'Work', 'Work/Notes'],
  );
});

await test('a missing selection returns to the root', () => {
  const folders = ['Work', 'Work/Plans'];
  assert.equal(selectedFolderOrRoot('Work/Plans', folders), 'Work/Plans');
  assert.equal(selectedFolderOrRoot('Work/Old', folders), '');
  assert.equal(selectedFolderOrRoot('', folders), '');
});
