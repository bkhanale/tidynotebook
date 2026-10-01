/**
 * The rules of the image viewer (record 0145): the fit, the zoom steps, the
 * actions of a picture, and the name a download takes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampZoom,
  fitZoom,
  imageActionLabels,
  imageActions,
  imageDownloadName,
  imageTitle,
  wheelZoom,
  zoomIn,
  zoomKey,
  zoomLimits,
  zoomOut,
  zoomPercent,
  zoomSteps,
  zoomedSize,
} from './image-viewer.ts';

await test('a large picture fits the room and a small one keeps its size', () => {
  const room = { width: 800, height: 600 };
  assert.equal(fitZoom({ width: 1600, height: 600 }, room), 0.5);
  assert.equal(fitZoom({ width: 800, height: 1200 }, room), 0.5);
  assert.equal(fitZoom({ width: 200, height: 100 }, room), 1);
});

await test('a picture or a room with no size shows at its own size', () => {
  assert.equal(fitZoom({ width: 0, height: 0 }, { width: 10, height: 10 }), 1);
  assert.equal(fitZoom({ width: 10, height: 10 }, { width: 0, height: 0 }), 1);
});

await test('a huge picture never fits below the smallest zoom', () => {
  assert.equal(
    fitZoom({ width: 100_000, height: 100 }, { width: 100, height: 100 }),
    zoomLimits.min,
  );
});

await test('the buttons move one step and stop at the limits', () => {
  assert.equal(zoomIn(1), 1.5);
  assert.equal(zoomOut(1), 0.75);
  // A fitted zoom between two steps moves to the next step in each way.
  assert.equal(zoomIn(0.6), 0.75);
  assert.equal(zoomOut(0.6), 0.5);
  assert.equal(zoomIn(zoomLimits.max), zoomLimits.max);
  assert.equal(zoomOut(zoomLimits.min), zoomLimits.min);
});

await test('the wheel zooms with the distance and stays inside the limits', () => {
  assert.ok(wheelZoom(1, -100) > 1);
  assert.ok(wheelZoom(1, 100) < 1);
  assert.equal(wheelZoom(zoomLimits.max, -10_000), zoomLimits.max);
  assert.equal(wheelZoom(zoomLimits.min, 10_000), zoomLimits.min);
  assert.equal(clampZoom(Number.NaN), 1);
});

await test('the keys zoom in, out, and back to the fit', () => {
  assert.equal(zoomKey('+'), 'in');
  assert.equal(zoomKey('='), 'in');
  assert.equal(zoomKey('-'), 'out');
  assert.equal(zoomKey('0'), 'fit');
  assert.equal(zoomKey('a'), null);
  assert.equal(zoomKey('Enter'), null);
});

await test('the zoomed size is whole pixels and never zero', () => {
  assert.deepEqual(zoomedSize({ width: 333, height: 101 }, 0.5), {
    width: 167,
    height: 51,
  });
  assert.deepEqual(zoomedSize({ width: 1, height: 1 }, 0.1), {
    width: 1,
    height: 1,
  });
  assert.equal(zoomPercent(0.5), '50%');
  assert.equal(zoomPercent(1.5), '150%');
});

await test('a picture of the workspace copies and downloads its bytes', () => {
  assert.deepEqual(imageActions(false), ['copy-image', 'download']);
});

await test('a picture of another host copies its link and opens the original', () => {
  // The page cannot read the bytes of another host, so it offers no action
  // that would need them.
  assert.deepEqual(imageActions(true), ['copy-link', 'open']);
  assert.deepEqual(
    imageActions(true).map((action) => imageActionLabels[action]),
    ['Copy link', 'Open original'],
  );
});

await test('the title is the alt text or a plain name', () => {
  assert.equal(imageTitle(' A red bike '), 'A red bike');
  assert.equal(imageTitle(''), 'Image');
});

await test('a download takes the name of the file without its identifier', () => {
  const note = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
  assert.equal(
    imageDownloadName(`attachments/${note}-photo.png`, 'alt'),
    'photo.png',
  );
  assert.equal(
    imageDownloadName(`../attachments/${note}-my%20chart.svg`, ''),
    'my chart.svg',
  );
  assert.equal(
    imageDownloadName('attachments/plan.jpg?x=1#top', ''),
    'plan.jpg',
  );
});

await test('a destination that names no file takes the alt text', () => {
  const revision = '/attachments/0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
  assert.equal(imageDownloadName(revision, 'Floor plan'), 'Floor plan');
  assert.equal(imageDownloadName(revision, ''), 'image');
});

await test('a download name holds no path and no unsafe character', () => {
  assert.equal(imageDownloadName('attachments/a%2Fb%3Ac.png', ''), 'a-b-c.png');
  assert.equal(imageDownloadName('attachments/..', ''), 'image');
  assert.equal(imageDownloadName('attachments/%00x.png', ''), 'x.png');
});

await test('the steps run from the smallest zoom to the largest', () => {
  const steps = [...zoomSteps];
  assert.equal(steps[0], zoomLimits.min);
  assert.equal(steps.at(-1), zoomLimits.max);
  assert.deepEqual(
    steps,
    [...steps].sort((left, right) => left - right),
  );
});
