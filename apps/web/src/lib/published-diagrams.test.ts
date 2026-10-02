/** The rules of the diagram script of a published page (record 0158). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { diagramLimits } from '../diagram/frame.ts';
import {
  darkPreferenceQuery,
  diagramThemeOf,
  drawsDiagram,
  publishedDiagramSelector,
} from './published-diagrams.ts';

await test('a diagram draws in the appearance that the device prefers', () => {
  assert.equal(diagramThemeOf(true), 'dark');
  assert.equal(diagramThemeOf(false), 'light');
  assert.equal(darkPreferenceQuery, '(prefers-color-scheme: dark)');
});

await test('the script reads the placeholder that the renderer writes', () => {
  // `renderMarkdown` writes `<pre data-diagram="mermaid">` for a fence.
  assert.equal(publishedDiagramSelector, 'pre[data-diagram="mermaid"]');
});

await test('an empty source and a source over the limit keep the code block', () => {
  assert.equal(drawsDiagram('graph TD;\n  A-->B;'), true);
  assert.equal(drawsDiagram('   \n'), false);
  assert.equal(drawsDiagram('a'.repeat(diagramLimits.maxSourceChars)), true);
  assert.equal(
    drawsDiagram('a'.repeat(diagramLimits.maxSourceChars + 1)),
    false,
  );
});
