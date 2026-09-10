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
import { diagramFrameStyle } from './frame.ts';

await test('the diagram frame lets a click reach the editor', () => {
  assert.equal(diagramFrameStyle['pointerEvents'], 'none');
});

await test('the diagram frame fills the measure and shows no border', () => {
  assert.equal(diagramFrameStyle['width'], '100%');
  assert.equal(diagramFrameStyle['border'], '0');
});
