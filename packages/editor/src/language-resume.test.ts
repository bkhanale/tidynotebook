/**
 * The editor grammar parses the same in slices as in one pass (record 0155).
 *
 * A view never parses a note in one pass. It stops at the end of the viewport
 * or when its time runs out, keeps the partial tree as fragments, and a later
 * parse reuses them. A block parser that depends on where a parse stopped
 * draws a wrong note only after a reload or a scroll, which is what the audit
 * of 2026-10-02 reported for display math. Each case here stops a parse at
 * every offset of a note, continues it, and requires the tree of one pass,
 * node by node with positions, the trees of a fence language included.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { TreeFragment, type PartialParse, type Tree } from '@lezer/common';
import {
  blockSyntaxMarkdown,
  corpusMarkdown,
} from '../../markdown/test-data/content.ts';
import { noteMarkdown, parsedWhole } from './language.ts';

const support = noteMarkdown();
const parser = support.language.parser;

/** Every node of a tree with its range, in document order. */
function shapeOf(tree: Tree): string {
  const nodes: string[] = [];
  tree.iterate({
    enter: (node) => {
      nodes.push(`${node.name}:${String(node.from)}-${String(node.to)}`);
    },
  });
  return nodes.join(' ');
}

/** Runs a parse to its end. */
function finish(parse: PartialParse): Tree {
  for (;;) {
    const tree = parse.advance();
    if (tree !== null) return tree;
  }
}

/**
 * A parse stopped at `stop`, then a parse of the same note that reuses the
 * partial tree, as `@codemirror/language` does after a slice. `steps` parse
 * steps run before the stop, so a stop can land before the front matter
 * wrapper has read the note or inside the Markdown parse that it holds.
 */
function resumedParse(doc: string, stop: number, steps: number): Tree {
  const first = parser.startParse(doc);
  for (let step = 0; step < steps; step += 1)
    if (first.advance() !== null) break;
  if (first.stoppedAt === null || first.stoppedAt > stop) first.stopAt(stop);
  const partial = finish(first);
  return finish(
    parser.startParse(doc, TreeFragment.addTree(partial, [], true)),
  );
}

/** The first offset at which a resumed parse differs, or null. */
function firstDifference(doc: string, steps: number): number | null {
  const whole = shapeOf(parser.parse(doc));
  for (let stop = 0; stop <= doc.length; stop += 1)
    if (shapeOf(resumedParse(doc, stop, steps)) !== whole) return stop;
  return null;
}

/** The block nodes that the note of block syntax must hold. */
const blockNodes = [
  'Frontmatter',
  'MathBlock',
  'FencedCode',
  'CodeBlock',
  'Table',
  'Blockquote',
  'Task',
  'BulletList',
  'FootnoteDefinition',
  'FootnoteReference',
] as const;

await test('the notes of the resume set hold every block syntax', () => {
  const found = new Set<string>();
  for (const doc of [corpusMarkdown, blockSyntaxMarkdown])
    parser.parse(doc).iterate({
      enter: (node) => {
        found.add(node.name);
      },
    });
  for (const name of blockNodes) assert.ok(found.has(name), name);
});

for (const [name, doc] of [
  ['the corpus', corpusMarkdown],
  ['the note of block syntax', blockSyntaxMarkdown],
] as const) {
  await test(`a parse of ${name} stopped at any offset resumes the same`, () => {
    // No step runs before the stop, so the wrapper of the front matter
    // stops, and the Markdown parse it holds ends at the stop.
    assert.equal(firstDifference(doc, 0), null);
  });

  await test(`a Markdown parse of ${name} stopped at any offset resumes the same`, () => {
    // A few steps let the wrapper read the whole note first, so the stop
    // lands in the Markdown parse, between two of its blocks.
    assert.equal(firstDifference(doc, 4), null);
  });
}

await test('a note typed up to any offset and then completed parses the same', () => {
  const doc = blockSyntaxMarkdown;
  const whole = shapeOf(parser.parse(doc));
  for (let at = 0; at <= doc.length; at += 1) {
    const typed = parsedWhole(
      EditorState.create({ doc: doc.slice(0, at), extensions: [support] }),
    );
    const completed = parsedWhole(
      typed.update({ changes: { from: at, insert: doc.slice(at) } }).state,
    );
    assert.equal(
      shapeOf(syntaxTree(completed)),
      whole,
      `typed up to ${String(at)}`,
    );
  }
});
