/**
 * The presentation invariants of the diagram frame.
 *
 * The frame is a sandboxed document inside a live-preview widget. A click on
 * a separate document moves the focus into it, so the widget never learns of
 * the click: the source of the diagram stays closed and every keystroke after
 * the click is lost. The frame therefore takes no pointer event.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampDiagramHeight,
  diagramFrameStyle,
  diagramLimits,
} from './frame.ts';

await test('the diagram frame lets a click reach the editor', () => {
  assert.equal(diagramFrameStyle['pointerEvents'], 'none');
});

await test('the diagram frame fills the measure and shows no border', () => {
  assert.equal(diagramFrameStyle['width'], '100%');
  assert.equal(diagramFrameStyle['border'], '0');
});

await test('the load clock is longer than the render clock', () => {
  // Two clocks answer two questions. The frame holds the whole diagram engine
  // inline, so the bytes need more time than the drawing, and a render budget
  // that started before the bytes arrived spent itself on the download. That
  // is what left a diagram as plain text on a slow link.
  assert.ok(diagramLimits.maxLoadMs > diagramLimits.maxRenderMs);
});

await test('a reported height is clamped into the applied bounds', () => {
  assert.equal(clampDiagramHeight(-1), diagramLimits.minHeightPx);
  assert.equal(clampDiagramHeight(Number.NaN), diagramLimits.minHeightPx);
  assert.equal(clampDiagramHeight(10_000), diagramLimits.maxHeightPx);
  assert.equal(clampDiagramHeight(240.4), 240);
});
