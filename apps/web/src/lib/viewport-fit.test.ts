/** The frame fits the visual viewport, so iOS cannot scroll it away. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { viewportFit } from './viewport-fit.ts';

await test('an open keyboard makes the frame as tall as what is visible', () => {
  assert.deepEqual(viewportFit({ height: 402.6, scale: 1 }), {
    height: 403,
    pinWindow: true,
  });
});

await test('a zoomed page keeps its default height and can move', () => {
  assert.deepEqual(viewportFit({ height: 300, scale: 2 }), {
    height: null,
    pinWindow: false,
  });
});

await test('a browser with no visual viewport keeps the default height', () => {
  assert.deepEqual(viewportFit(null), { height: null, pinWindow: false });
  assert.deepEqual(viewportFit({ height: 0, scale: 1 }), {
    height: null,
    pinWindow: false,
  });
});
