import assert from 'node:assert/strict';
import test from 'node:test';
import { keepsCaretInView } from './caret-in-view.ts';

await test('a keyboard that opens over the text brings the caret back', () => {
  // The frame shrank above the keyboard and the line of the caret stood
  // under the keys until the first key.
  assert.equal(
    keepsCaretInView({ before: 700, after: 364, focused: true }),
    true,
  );
});

await test('the text keeps its place when it has no focus or grows', () => {
  // A person who reads the note and turns the phone moves no scroll.
  assert.equal(
    keepsCaretInView({ before: 700, after: 364, focused: false }),
    false,
  );
  // The keyboard closes: the caret is still in view in a taller text.
  assert.equal(
    keepsCaretInView({ before: 364, after: 700, focused: true }),
    false,
  );
  assert.equal(
    keepsCaretInView({ before: 700, after: 700, focused: true }),
    false,
  );
});
