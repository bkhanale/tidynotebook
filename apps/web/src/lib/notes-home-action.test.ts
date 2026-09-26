import assert from 'node:assert/strict';
import test from 'node:test';
import { showNewNoteInHeader } from './notes-home-action.ts';

await test('the empty note list shows its only New note action in the empty state', () => {
  assert.equal(showNewNoteInHeader(false, 0), false);
});

await test('the header holds New note while loading or when notes exist', () => {
  assert.equal(showNewNoteInHeader(true, 0), true);
  assert.equal(showNewNoteInHeader(false, 1), true);
});
