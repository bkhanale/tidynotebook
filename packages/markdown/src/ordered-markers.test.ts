/** The ordered marker cycle and the labels it gives. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  orderedMarkerLabel,
  orderedMarkerStyle,
  orderedMarkerStyles,
} from './ordered-markers.ts';

await test('the styles cycle from the outer list inward', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map((level) => orderedMarkerStyle(level)),
    [
      'decimal',
      'upper-alpha',
      'lower-roman',
      'decimal',
      'upper-alpha',
      'lower-roman',
      'decimal',
    ],
  );
  assert.equal(orderedMarkerStyles.length, 3);
});

await test('each level labels the first items in its own style', () => {
  const labels = (level: number): readonly string[] =>
    [1, 2, 3, 4].map((value) => orderedMarkerLabel(value, level));
  assert.deepEqual(labels(0), ['1.', '2.', '3.', '4.']);
  assert.deepEqual(labels(1), ['A.', 'B.', 'C.', 'D.']);
  assert.deepEqual(labels(2), ['i.', 'ii.', 'iii.', 'iv.']);
  assert.deepEqual(labels(3), ['1.', '2.', '3.', '4.']);
});

await test('an alphabetic label continues past Z as CSS counts it', () => {
  assert.equal(orderedMarkerLabel(26, 1), 'Z.');
  assert.equal(orderedMarkerLabel(27, 1), 'AA.');
  assert.equal(orderedMarkerLabel(52, 1), 'AZ.');
  assert.equal(orderedMarkerLabel(703, 1), 'AAA.');
});

await test('a roman label writes the subtractive forms', () => {
  assert.equal(orderedMarkerLabel(9, 2), 'ix.');
  assert.equal(orderedMarkerLabel(14, 2), 'xiv.');
  assert.equal(orderedMarkerLabel(1994, 2), 'mcmxciv.');
  assert.equal(orderedMarkerLabel(3999, 2), 'mmmcmxcix.');
});

await test('a value outside the range of a style falls back to decimal', () => {
  // CommonMark allows a list to start at zero, and CSS has no letter and no
  // numeral for it, so a browser draws the number. The live preview does the
  // same, so the two readers agree.
  assert.equal(orderedMarkerLabel(0, 1), '0.');
  assert.equal(orderedMarkerLabel(0, 2), '0.');
  assert.equal(orderedMarkerLabel(4000, 2), '4000.');
});
