/**
 * Rich widget scanning checks.
 *
 * These tests assert exact source boundaries and prove the original text is
 * untouched. Rendering itself needs a browser document, so failure paths are
 * covered through the pure helpers: oversized regions stay source, unknown
 * tables stay source, and code spans never become widgets. Manual focus and
 * source editing checks happen during development; see `widgets.ts`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findRichWidgets,
  parseTableSource,
  richLimits,
  shouldPreserveAsSource,
  type RichWidget,
} from './widgets.ts';

/** Finds the single widget of one kind, or fails with its kinds. */
function single(
  widgets: readonly RichWidget[],
  kind: RichWidget['kind'],
): RichWidget {
  const found = widgets.filter((widget) => widget.kind === kind);
  assert.equal(
    found.length,
    1,
    `expected one ${kind}, found ${found.map((widget) => widget.kind).join(',')}`,
  );
  const first = found[0];
  assert.ok(first !== undefined);
  return first;
}

await test('an inline image reports its exact range', () => {
  const text = 'See ![alt](/attachments/abc) here.';
  const widget = single(findRichWidgets(text), 'image');
  assert.equal(text.slice(widget.from, widget.to), '![alt](/attachments/abc)');
  assert.equal(widget.source, '![alt](/attachments/abc)');
});

await test('an image inside code never becomes a widget', () => {
  const fenced = '```\n![alt](/attachments/abc)\n```';
  assert.ok(findRichWidgets(fenced).every((widget) => widget.kind !== 'image'));
  const span = 'Use `![alt](/attachments/abc)` here.';
  assert.ok(findRichWidgets(span).every((widget) => widget.kind !== 'image'));
});

await test('inline and display math report exact ranges', () => {
  const text = 'Pay $x^2$ now.\n\n$$y^2$$\n';
  const widgets = findRichWidgets(text);
  const inline = single(widgets, 'math-inline');
  assert.equal(text.slice(inline.from, inline.to), '$x^2$');
  const display = single(widgets, 'math-display');
  assert.equal(text.slice(display.from, display.to), '$$y^2$$');
});

await test('a mermaid fence reports from its opener to its closer', () => {
  const text = 'Before.\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n\nAfter.';
  const widget = single(findRichWidgets(text), 'diagram');
  assert.equal(text.slice(widget.from, widget.to), widget.source);
  assert.ok(widget.source.startsWith('```mermaid'));
  assert.ok(widget.source.trimEnd().endsWith('```'));
});

await test('an unclosed fence reports no diagram widget', () => {
  const text = '```mermaid\ngraph TD;\n  A-->B;\n';
  assert.ok(findRichWidgets(text).every((widget) => widget.kind !== 'diagram'));
});

await test('a table reports one range over its rows', () => {
  const text = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n';
  const widget = single(findRichWidgets(text), 'table');
  assert.equal(text.slice(widget.from, widget.to), widget.source);
  const parsed = parseTableSource(widget.source);
  assert.ok(parsed !== null);
  assert.deepEqual(parsed.header, ['A', 'B']);
  assert.equal(parsed.rows.length, 2);
});

await test('a non table with pipes parses to null and stays source', () => {
  assert.equal(parseTableSource('| A | B |\n| plain | text |\n'), null);
  assert.equal(parseTableSource('just text'), null);
});

await test('an oversized region is preserved as editable source', () => {
  const big = `$$${'x'.repeat(richLimits.maxMathChars + 1)}$$`;
  const widget = single(findRichWidgets(big), 'math-display');
  assert.ok(shouldPreserveAsSource(widget));
  const tall = `${'| A |\n|---|\n'}${'| x |\n'.repeat(richLimits.maxTableRows + 1)}`;
  const table = single(findRichWidgets(tall), 'table');
  assert.ok(shouldPreserveAsSource(table));
});

await test('an ordinary region renders rather than staying source', () => {
  const text = 'See $x$ here.';
  const widget = single(findRichWidgets(text), 'math-inline');
  assert.equal(shouldPreserveAsSource(widget), false);
});

await test('scanning leaves the source string untouched', () => {
  const text =
    '# T\n\nSee ![a](/attachments/b) and $x$.\n\n```mermaid\nA\n```\n';
  const before = text;
  findRichWidgets(text);
  assert.equal(text, before);
});
