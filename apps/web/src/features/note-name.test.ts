import assert from 'node:assert/strict';
import test from 'node:test';
import { displayNoteName, storageNotePath } from './note-name.ts';

await test('the interface hides the Markdown storage suffix', () => {
  assert.equal(displayNoteName('projects/roadmap.md'), 'projects/roadmap');
  assert.equal(displayNoteName('projects/roadmap.MD'), 'projects/roadmap');
});

await test('a visible note name gets one canonical storage suffix', () => {
  assert.equal(storageNotePath('projects/roadmap'), 'projects/roadmap.md');
  assert.equal(storageNotePath('projects/roadmap.md'), 'projects/roadmap.md');
  assert.equal(storageNotePath('projects/roadmap.MD'), 'projects/roadmap.md');
});
