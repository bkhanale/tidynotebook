import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleArea } from './visible-area.ts';

/** A phone screen in its layout viewport. */
const phone = { width: 390, height: 844 };

await test('an open keyboard ends the visible area at its top edge', () => {
  // iOS Safari keeps the layout viewport at 844 and shrinks only the visual
  // viewport, so a list placed in the layout viewport opened under the keys.
  const area = visibleArea(
    { offsetTop: 0, offsetLeft: 0, width: 390, height: 508 },
    phone,
  );
  assert.deepEqual(area, { top: 0, left: 0, bottom: 508, right: 390 });
});

await test('a browser with no visual viewport shows the whole layout viewport', () => {
  assert.deepEqual(visibleArea(null, phone), {
    top: 0,
    left: 0,
    bottom: 844,
    right: 390,
  });
});

await test('a moved visual viewport stays inside the layout viewport', () => {
  const area = visibleArea(
    { offsetTop: 100, offsetLeft: 20, width: 400, height: 800 },
    phone,
  );
  assert.deepEqual(area, { top: 100, left: 20, bottom: 844, right: 390 });
});

await test('an empty visual viewport falls back to the layout viewport', () => {
  const area = visibleArea(
    { offsetTop: 0, offsetLeft: 0, width: 0, height: 0 },
    phone,
  );
  assert.deepEqual(area, { top: 0, left: 0, bottom: 844, right: 390 });
});
