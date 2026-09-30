import assert from 'node:assert/strict';
import test from 'node:test';
import { doubledTaskBoxes } from './task-boxes.ts';

/** The characters of each slot, so a failure shows the box it named. */
function slotTexts(text: string): readonly string[] {
  return doubledTaskBoxes(text).map((slot) => text.slice(slot.from, slot.to));
}

await test('a box that two toggles wrote into is named', () => {
  assert.deepEqual(slotTexts('- [x ] task\n'), ['x ']);
  assert.deepEqual(slotTexts('- [ x] task\n'), [' x']);
  assert.deepEqual(slotTexts('- [xx] task\n'), ['xx']);
  assert.deepEqual(slotTexts('- [  ] task\n'), ['  ']);
  assert.deepEqual(slotTexts('- [xX ] task\n'), ['xX ']);
});

await test('a slot names the offsets of the characters between the brackets', () => {
  const text = '# Tasks\n\n- [ ] one\n  1. [x ] two\n';
  const [slot] = doubledTaskBoxes(text);
  assert.deepEqual(slot, {
    from: text.indexOf('[x ]') + 1,
    to: text.indexOf('[x ]') + 3,
  });
});

await test('every marker and a nested item are read', () => {
  assert.deepEqual(
    slotTexts('* [xx] a\n+ [xx] b\n1) [xx] c\n    - [xx] d\n\t- [xx] e'),
    ['xx', 'xx', 'xx', 'xx', 'xx'],
  );
});

await test('a box with one state is not named', () => {
  assert.deepEqual(slotTexts('- [ ] one\n- [x] two\n- [X] three\n'), []);
});

await test('brackets that are not a box are not named', () => {
  // Words between the brackets, no list marker, no gap after the marker, and
  // text right after the closing bracket are not a task box.
  assert.deepEqual(
    slotTexts('- [xo] a\n[xx] b\n-[xx] c\n- [xx]d\nsee [xx] here\n'),
    [],
  );
});
