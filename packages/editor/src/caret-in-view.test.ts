import assert from 'node:assert/strict';
import test from 'node:test';
import { keepsCaretInView } from './caret-in-view.ts';

/** A caret on a line low in a text 700 px tall, in view. */
const low = { caretTop: 600, caretBottom: 624 };

await test('a keyboard that opens over the caret brings the caret back', () => {
  // The frame shrank above the keyboard and the line of the caret stood
  // under the keys until the first key.
  assert.equal(
    keepsCaretInView({ before: 700, after: 364, focused: true, ...low }),
    true,
  );
});

await test('the text keeps its place when the caret stays in view', () => {
  assert.equal(
    keepsCaretInView({
      before: 700,
      after: 364,
      focused: true,
      caretTop: 100,
      caretBottom: 124,
    }),
    false,
  );
});

await test('a caret the person scrolled away from does not pull the text back', () => {
  // The person reads far below the caret, and a notice takes room from the
  // text: the reading place stays.
  for (const away of [
    { caretTop: -900, caretBottom: -876 },
    { caretTop: 1400, caretBottom: 1424 },
  ])
    assert.equal(
      keepsCaretInView({ before: 700, after: 364, focused: true, ...away }),
      false,
    );
});

await test('the text keeps its place when it has no focus or grows', () => {
  // A person who reads the note and turns the phone moves no scroll.
  assert.equal(
    keepsCaretInView({ before: 700, after: 364, focused: false, ...low }),
    false,
  );
  // The keyboard closes: the caret is still in view in a taller text.
  assert.equal(
    keepsCaretInView({ before: 364, after: 700, focused: true, ...low }),
    false,
  );
  assert.equal(
    keepsCaretInView({ before: 700, after: 700, focused: true, ...low }),
    false,
  );
});
