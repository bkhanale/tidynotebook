import assert from 'node:assert/strict';
import test from 'node:test';
import { dragStep, type DragInput } from './table-drag.ts';

/** A press of the mouse at 100, 100 that has not moved yet. */
const press = { pointerId: 1, startX: 100, startY: 100, moving: false };

/** One event of the pointer that pressed, with the left button down. */
function move(x: number, y: number, buttons = 1): DragInput {
  return { type: 'move', pointerId: 1, buttons, x, y };
}

await test('a press becomes a drag once the pointer travels', () => {
  assert.equal(dragStep(press, move(102, 101)), 'ignore');
  assert.equal(dragStep(press, move(104, 100)), 'follow');
  // A drag keeps following, even back over the place it started.
  assert.equal(dragStep({ ...press, moving: true }, move(100, 100)), 'follow');
});

await test('a release ends the drag wherever it lands', () => {
  // Regression: a drag that heard the release on its handle alone missed it
  // when the browser dropped the pointer capture, and the drag stayed open
  // with its handle stuck on the column.
  const release: DragInput = {
    type: 'release',
    pointerId: 1,
    buttons: 0,
    x: 900,
    y: 20,
  };
  assert.equal(dragStep({ ...press, moving: true }, release), 'end');
  assert.equal(dragStep(press, release), 'end');
  // A move with no button down is a release that never reached the window.
  assert.equal(dragStep({ ...press, moving: true }, move(300, 100, 0)), 'end');
});

await test('Escape, a cancel and a blur cancel the drag', () => {
  assert.equal(
    dragStep({ ...press, moving: true }, { type: 'cancel' }),
    'cancel',
  );
});

await test('another pointer takes no part in the drag', () => {
  assert.equal(
    dragStep(press, { type: 'release', pointerId: 2, buttons: 0, x: 0, y: 0 }),
    'ignore',
  );
  assert.equal(
    dragStep(press, { type: 'move', pointerId: 2, buttons: 1, x: 300, y: 0 }),
    'ignore',
  );
});
