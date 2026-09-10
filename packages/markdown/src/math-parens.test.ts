/**
 * The `\(...\)` inline math pair.
 *
 * `\(` is a CommonMark character escape, so the pair needs a construct of its
 * own. These checks hold the delimiter rule of `./math-syntax.ts`: the pair
 * opens math, every other backslash keeps its CommonMark meaning, and the
 * result is the same `inlineMath` node as `$$...$$`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Nodes, PhrasingContent } from 'mdast';
import { parseMarkdown } from './parse.ts';
import { renderMarkdown } from './render.ts';

/** The inline children of the one paragraph of `source`. */
function inline(source: string): readonly PhrasingContent[] {
  const first = parseMarkdown(source).children[0];
  assert.ok(first !== undefined && first.type === 'paragraph');
  return first.children;
}

/** The inline math node type that remark-math registers on the tree. */
type InlineMathNode = Extract<Nodes, { type: 'inlineMath' }>;

/** The one inline math node of `source`, or a failure. */
function onlyMath(source: string): InlineMathNode {
  const found = inline(source).filter(
    (node): node is InlineMathNode => node.type === 'inlineMath',
  );
  assert.equal(found.length, 1, `one inline math node in ${source}`);
  const node = found[0];
  assert.ok(node !== undefined);
  return node;
}

await test('the pair builds the same node that two dollars build', () => {
  assert.equal(onlyMath('Text \\(a^2 + b^2\\) end.').value, 'a^2 + b^2');
  assert.equal(onlyMath('Text $$a^2 + b^2$$ end.').value, 'a^2 + b^2');
});

await test('a backslash command inside the math is kept', () => {
  assert.equal(onlyMath('Sum \\(a \\times b\\) end.').value, 'a \\times b');
});

await test('an empty pair is empty math, not text', () => {
  assert.equal(onlyMath('Nothing \\(\\) here.').value, '');
});

await test('the math node addresses its own source', () => {
  const source = 'ab \\(x\\) cd';
  const node = onlyMath(source);
  assert.equal(
    source.slice(
      node.position?.start.offset ?? -1,
      node.position?.end.offset ?? -1,
    ),
    '\\(x\\)',
  );
});

await test('an escaped backslash before the parenthesis is not math', () => {
  assert.deepEqual(
    inline('Escaped \\\\(a\\) end.').map((node) => node.type),
    ['text'],
  );
});

await test('a pair that no line closes stays text', () => {
  assert.deepEqual(
    inline('Open \\(a only.').map((node) => node.type),
    ['text'],
  );
  assert.deepEqual(
    inline('Open \\(a\nand \\) later.').map((node) => node.type),
    ['text'],
  );
});

await test('the pair renders through the same math stage as two dollars', async () => {
  const html = await renderMarkdown('Text \\(a^2\\) end.');
  assert.match(html, /notes-math notes-math-inline/);
  assert.match(html, /data-math="inline"/);
  assert.ok(!html.includes('(a^2)'), 'the escape no longer eats the pair');
});

await test('math inside inline code stays code', () => {
  assert.deepEqual(
    inline('Code `\\(a\\)` end.').map((node) => node.type),
    ['text', 'inlineCode', 'text'],
  );
});
