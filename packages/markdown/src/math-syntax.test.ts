/**
 * Math delimiter rule checks.
 *
 * The rule is shared by the remark parser in this package and by the live
 * preview parser in `@notesapp/editor`. These tests state the rule once, so a
 * change that breaks one engine breaks this suite first.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closingDisplayMathFence,
  inlineMathDelimiters,
  openingDisplayMathFence,
  singleDollarTextMath,
} from './math-syntax.ts';

await test('one dollar never opens math', () => {
  assert.equal(singleDollarTextMath, false);
});

await test('inline math accepts two dollars and the LaTeX parentheses', () => {
  assert.deepEqual(
    inlineMathDelimiters.map((pair) => `${pair.open}${pair.close}`),
    ['$$$$', '\\(\\)'],
  );
});

await test('a display fence opens on its own line and keeps its info string', () => {
  assert.deepEqual(openingDisplayMathFence('$$'), {
    markFrom: 0,
    markTo: 2,
    infoFrom: 2,
    infoTo: 2,
  });
  assert.deepEqual(openingDisplayMathFence('   $$$ label '), {
    markFrom: 3,
    markTo: 6,
    infoFrom: 7,
    infoTo: 12,
  });
});

await test('a line whose info string holds a dollar is not a display fence', () => {
  // This is what keeps `$$x^2$$` inline math rather than an empty block.
  assert.equal(openingDisplayMathFence('$$x^2$$'), null);
  assert.equal(openingDisplayMathFence('$'), null);
  assert.equal(openingDisplayMathFence('    $$'), null);
});

await test('a closing fence holds only dollars and is long enough', () => {
  assert.equal(closingDisplayMathFence('$$', 2), 2);
  assert.equal(closingDisplayMathFence('$$$  ', 2), 3);
  assert.equal(closingDisplayMathFence('$$', 3), -1);
  assert.equal(closingDisplayMathFence('$$ tail', 2), -1);
});
