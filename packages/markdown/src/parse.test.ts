/**
 * The parse of the blocks alone, and the reading of the lines that decides
 * when it runs (record 0182).
 *
 * The limit of the marks of one inline block rests on two facts. The parse
 * with every inline construct off finds exactly the inline blocks of the
 * full parse, so no second scanner decides where a block ends. And the count
 * of a part between blank lines is never below the count of a block in it,
 * and the count of table cells never below the cells of the full parse, so
 * the reading of the lines never lets a note past a limit that the parse of
 * its blocks would refuse. Both facts are held here over the corpus and over
 * many notes made of every kind of block line, with a fixed seed, so a run
 * reads the same notes each time.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Nodes, Root } from 'mdast';
import { inlineMarks, linesOf, measureLines } from './limits.ts';
import { parseBlocks, parseMarkdown } from './parse.ts';
import { blockSyntaxMarkdown, corpusMarkdown } from '../test-data/content.ts';

/** The nodes of a tree whose content micromark reads as one inline block. */
const inlineBlockTypes = new Set(['paragraph', 'heading', 'tableCell']);

/** One inline block: its kind and its source offsets. */
type Placed = {
  readonly type: string;
  readonly from: number;
  readonly to: number;
};

/** The inline blocks of a tree, in document order. */
function inlineBlocksOf(tree: Root): Placed[] {
  const found: Placed[] = [];
  const pending: Nodes[] = [tree];
  let node = pending.shift();
  while (node !== undefined) {
    if (inlineBlockTypes.has(node.type))
      found.push({
        type: node.type,
        from: node.position?.start.offset ?? -1,
        to: node.position?.end.offset ?? -1,
      });
    else if ('children' in node) pending.unshift(...node.children);
    node = pending.shift();
  }
  return found;
}

/** The node kinds that only an inline construct makes. */
const inlineKinds = new Set([
  'delete',
  'emphasis',
  'footnoteReference',
  'image',
  'imageReference',
  'inlineCode',
  'inlineMath',
  'link',
  'linkReference',
  'strong',
]);

/**
 * Whether a link is a bare address of the text.
 *
 * GFM finds a bare address in the text after the parse and makes it a link,
 * with no construct of micromark and no new block, so a parse of the blocks
 * still has it. A link of a label holds the words of the label instead.
 */
function bareAddress(node: Nodes): boolean {
  if (node.type !== 'link' || node.children.length !== 1) return false;
  const child = node.children[0];
  return (
    child?.type === 'text' &&
    (node.url === child.value || node.url === `mailto:${child.value}`)
  );
}

/** Whether a tree holds a node that only an inline construct makes. */
function holdsInline(tree: Root): boolean {
  const pending: Nodes[] = [tree];
  let node = pending.pop();
  while (node !== undefined) {
    if (inlineKinds.has(node.type) && !bareAddress(node)) return true;
    if ('children' in node) pending.push(...node.children);
    node = pending.pop();
  }
  return false;
}

/** Lines of every kind of block, and inline marks inside them. */
const fragments = [
  '',
  '',
  'Plain words of a paragraph.',
  'Words with *a*, **b**, ~~c~~, _d_ and `e`.',
  '[a link](u) and ![an image](i) and <https://a.b> and <b>c</b>.',
  'Math $a$ and $$b$$ and \\(c\\) and a price of $5.',
  '*a [b *c](d) e* f]] g [[h',
  '- a bullet with *marks*',
  '* a star bullet [x]',
  '+ a plus bullet $y$',
  '1. an ordered item *z*',
  '2) another ordered item [w]',
  '3. a later item',
  '-',
  '- [ ] a task *q*',
  '  - a nested bullet *n*',
  '    - a deeper bullet [d]',
  '    four spaces of *indent*',
  '\ta tab of [indent]',
  '> a quote *q*',
  '> > a nested quote [r]',
  '>',
  '> - a list in a quote',
  '# A heading *h*',
  '### A heading ### with [x]',
  'Setext *heading*',
  '===',
  '---',
  '***',
  '* * *',
  '```',
  '```js',
  '~~~',
  '    ```',
  '$$',
  '$$ x $$',
  '<div>',
  '</div>',
  '<pre>',
  '</pre>',
  '<!-- a comment',
  '-->',
  '|a|b|',
  '| a | b |',
  '|-|-|',
  '| --- | :-: |',
  '|-|',
  'a | b',
  '--- | ---',
  '|*c*|[d](e)|',
  '| x \\| y | z |',
  '> |a|b|',
  '> |-|-|',
  '- |a|b|',
  '  |-|-|',
  '[ref]: /url "title"',
  '[^1]: a footnote *f*',
  '    a footnote line [g]',
  '[^1] and [ref] and [^2]',
  '\\* an escaped star and \\[ a bracket',
  '<!-- -->*a*',
];

/** A seeded generator, so each run reads the same notes. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Notes of up to fourteen lines, drawn from `fragments`. */
function generatedNotes(count: number): string[] {
  const random = seeded(186);
  const notes: string[] = [];
  for (let note = 0; note < count; note += 1) {
    const lines: string[] = [];
    const length = 1 + Math.floor(random() * 14);
    for (let line = 0; line < length; line += 1)
      lines.push(fragments[Math.floor(random() * fragments.length)] ?? '');
    notes.push(lines.join(random() < 0.1 ? '\r\n' : '\n'));
  }
  return notes;
}

const notes = [corpusMarkdown, blockSyntaxMarkdown, ...generatedNotes(4000)];

await test('the parse of the blocks finds exactly the inline blocks of the full parse', () => {
  for (const source of notes) {
    const blocks = parseBlocks(source);
    assert.equal(holdsInline(blocks), false, source);
    assert.deepEqual(
      inlineBlocksOf(blocks),
      inlineBlocksOf(parseMarkdown(source)),
      source,
    );
  }
});

await test('no inline block holds more marks than the part of the note around it', () => {
  for (const source of notes) {
    const measured = measureLines(linesOf(source));
    const tree = parseMarkdown(source);
    for (const block of inlineBlocksOf(tree))
      assert.ok(
        inlineMarks(source, block.from, block.to) <= measured.partMarks,
        source,
      );
    const cells = inlineBlocksOf(tree).filter(
      (block) => block.type === 'tableCell',
    ).length;
    assert.ok(cells <= measured.tableCells, source);
  }
});

await test('a note of only paragraphs needs no parse of its blocks', () => {
  // Most notes hold few marks in each part, so the reading of the lines
  // decides alone and the note is parsed once.
  for (const source of [corpusMarkdown, blockSyntaxMarkdown])
    assert.ok(measureLines(linesOf(source)).partMarks <= 128);
});
