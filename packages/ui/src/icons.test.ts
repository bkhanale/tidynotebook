/**
 * The one grid of the icon set.
 *
 * Node loads no `.tsx` file, and `tools/check-boundaries.mjs` allows a test
 * of a browser package no Node built in module but the test runner, so this
 * file cannot read `./icons.tsx` at all. It proves the facts instead: the
 * grid, the two sizes and the shared attributes that one frame in `icons.tsx`
 * spreads. Every icon reads them, and the `icon-attribute` rule of
 * `tools/check-design-rules.mjs` refuses an element anywhere in the product
 * that writes a viewport, a stroke or a line end of its own, which is what
 * makes reading them the only way an icon can be drawn.
 *
 * See
 * [decision 0065](../../../docs/decisions/0065-one-recipe-for-a-control-and-one-grid-for-an-icon.md).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultIconSize, iconAttributes, iconGrid } from './icon-grid.ts';

await test('the grid is one viewport, one stroke and two sizes', () => {
  assert.equal(iconGrid.viewBox, '0 0 24 24');
  assert.equal(iconGrid.strokeWidth, 1.5);
  assert.deepEqual([...iconGrid.sizes], [16, 20]);
});

await test('the default size is one of the two sizes', () => {
  assert.equal(defaultIconSize, 16);
  assert.ok(
    iconGrid.sizes.includes(defaultIconSize),
    'the default size is off the scale',
  );
});

await test('the shared attributes state the grid and hide the glyph', () => {
  assert.equal(iconAttributes.viewBox, iconGrid.viewBox);
  assert.equal(iconAttributes.strokeWidth, iconGrid.strokeWidth);
  assert.equal(iconAttributes.stroke, 'currentColor');
  assert.equal(iconAttributes.fill, 'none');
  assert.equal(iconAttributes.strokeLinecap, 'round');
  assert.equal(iconAttributes.strokeLinejoin, 'round');
  // The control around an icon carries the name, so the glyph carries none.
  assert.equal(iconAttributes['aria-hidden'], 'true');
});

await test('the stroke follows the text colour and never a value', () => {
  // A stroke of its own would hold a colour that no contrast rule reads.
  for (const value of Object.values(iconAttributes))
    assert.ok(
      typeof value !== 'string' || !value.startsWith('#'),
      `${String(value)} is a colour value`,
    );
});
