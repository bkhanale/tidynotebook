/**
 * The glyphs that plain DOM draws stay on the grid of the icon set.
 *
 * `tools/source-text.test.mjs` holds each glyph to the icon of the same name
 * in `./icons.tsx`, which a test of this package cannot read.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arrowDownParts,
  arrowUpParts,
  checkParts,
  closeParts,
  copyParts,
  gripParts,
  plusParts,
  type GlyphPart,
} from './glyph-parts.ts';

/** Every number of one part. */
function numbersOf(part: GlyphPart): readonly number[] {
  switch (part.kind) {
    case 'path':
      return (part.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    case 'polyline':
      return part.points.split(/\s+/).map(Number);
    case 'line':
      return [part.x1, part.y1, part.x2, part.y2];
    case 'rect':
      return [part.x, part.y, part.x + part.width, part.y + part.height];
    case 'circle':
      return [part.cx - part.r, part.cy - part.r, part.cx + part.r, part.cy + part.r];
  }
}

await test('every glyph lies on the 24 grid', () => {
  for (const parts of [
    plusParts,
    copyParts,
    checkParts,
    closeParts,
    arrowUpParts,
    arrowDownParts,
    gripParts(true),
    gripParts(false),
  ]) {
    assert.ok(parts.length > 0);
    for (const part of parts)
      for (const value of numbersOf(part))
        assert.ok(Math.abs(value) <= 24, `${String(value)} is off the grid`);
  }
});

await test('a grip is six dots', () => {
  assert.equal(gripParts(true).length, 6);
  assert.deepEqual(
    gripParts(false).map((part) => (part.kind === 'circle' ? part.cy : -1)),
    [9, 9, 9, 15, 15, 15],
  );
});
