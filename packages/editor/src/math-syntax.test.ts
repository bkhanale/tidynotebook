/**
 * Checks the reader of the container depth of a parser line.
 *
 * `Line.depth` is how the upstream Markdown parser reports that a container,
 * for example a block quote, ended on this line. The field is public in the
 * parser but absent from its declarations, so the math extension proves it at
 * run time. A line without it means that the pinned parser changed in a way
 * this extension cannot follow, and the refusal must be loud rather than a
 * number that closes a math block in the wrong place.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { parseMarkdown } from '@notesapp/markdown';
import { containerDepth } from './math-syntax.ts';
import { noteMarkdown, parsedWhole } from './language.ts';

await test('a line that reports its depth reads back that number', () => {
  for (const depth of [0, 1, 4]) assert.equal(containerDepth({ depth }), depth);
});

await test('a line without a numeric depth stops the parse', () => {
  for (const line of [{}, { depth: '2' }, { depth: null }, { other: 2 }])
    assert.throws(() => containerDepth(line), /container depth/);
});

await test('a display math block closes at the end of its block quote', () => {
  // The depth is what ends the block here: the third line leaves the quote,
  // so the math block must not swallow it.
  const doc = '> $$\n> a = b\n\nplain text\n';
  const state = parsedWhole(
    EditorState.create({ doc, extensions: [noteMarkdown()] }),
  );
  const blocks: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'MathBlock')
        blocks.push({ from: node.from, to: node.to });
    },
  });
  assert.equal(blocks.length, 1);
  assert.ok(
    (blocks[0]?.to ?? 0) <= doc.indexOf('plain text'),
    'the math block reached past its block quote',
  );
});

/** The names of the blocks of a note, at the top level and inside an item. */
function blockNames(doc: string): readonly string[] {
  const state = parsedWhole(
    EditorState.create({ doc, extensions: [noteMarkdown()] }),
  );
  const names: string[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Paragraph' || node.name === 'MathBlock')
        names.push(node.name);
      return node.name !== 'Paragraph' && node.name !== 'MathBlock';
    },
  });
  return names;
}

await test('a display math fence ends the paragraph above it', () => {
  // The defect this covers: the editor read the fence and the formula as
  // more lines of the paragraph, while the published page drew a formula.
  const doc = 'A paragraph.\n$$\np\n$$\n';
  assert.deepEqual(blockNames(doc), ['Paragraph', 'MathBlock']);
  assert.deepEqual(
    parseMarkdown(doc).children.map((child) => child.type),
    ['paragraph', 'math'],
  );
  assert.deepEqual(blockNames('- item\n  $$\n  x\n  $$\n'), [
    'Paragraph',
    'MathBlock',
  ]);
  // Inline math on a line of its own stays in the paragraph.
  assert.deepEqual(blockNames('A paragraph.\n$$x$$\n'), ['Paragraph']);
  assert.deepEqual(
    parseMarkdown('A paragraph.\n$$x$$\n').children.map((child) => child.type),
    ['paragraph'],
  );
});
