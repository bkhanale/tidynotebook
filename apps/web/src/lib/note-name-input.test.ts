import assert from 'node:assert/strict';
import test from 'node:test';
import { noteNameInputPolicy } from './note-name-input.ts';

await test('the note name does not ask for saved personal data', () => {
  // Issue 142. A note name is not a name from the address book, so the field
  // must tell the keyboard that it takes no saved value.
  assert.deepEqual(noteNameInputPolicy(), { autoComplete: 'off' });
});
