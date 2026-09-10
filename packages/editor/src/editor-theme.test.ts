/**
 * The layout invariants of the note surface style.
 *
 * These rules are geometry, not decoration. `.cm-content` is the editable
 * element of CodeMirror, so only padding on that element keeps the empty
 * strip under the last line inside the text. When the padding sits on
 * `.cm-scroller` instead, a click under the last line hits a plain division,
 * no caret is placed, and every keystroke after it is lost.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { noteSurfaceStyle } from './editor-theme.ts';

/** One rule of the surface style, read as a flat record. */
function rule(selector: string): Record<string, unknown> {
  const style = noteSurfaceStyle() as Record<string, unknown>;
  const found = style[selector];
  assert.ok(
    typeof found === 'object' && found !== null,
    `the surface style has no ${selector} rule`,
  );
  return found as Record<string, unknown>;
}

await test('the block padding of the surface sits on the editable element', () => {
  assert.equal(rule('.cm-scroller').paddingBlock, undefined);
  assert.equal(rule('.cm-scroller').padding, undefined);
  assert.equal(rule('.cm-content').paddingBlock, 'calc(var(--spacing) * 6)');
});

await test('the scroller stretches its content over its full height', () => {
  assert.equal(rule('.cm-scroller').alignItems, 'stretch');
  assert.equal(rule('.cm-content').width, '100%');
});
