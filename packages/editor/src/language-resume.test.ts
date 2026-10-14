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
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
  NodeProp,
  TreeFragment,
  type PartialParse,
  type Tree,
} from '@lezer/common';
import {
  blockSyntaxMarkdown,
  corpusMarkdown,
} from '../../markdown/test-data/content.ts';
import { codeLanguages, noteMarkdown, parsedWhole } from './language.ts';
import { previewStructureOf } from './live-preview.ts';

// Each fence language loads first, so the tree of a fence holds the tree of
// its language and a stop inside JavaScript, CSS or HTML is a stop inside a
// mounted tree, as it is in a view that has loaded the language.
await Promise.all(codeLanguages.map((description) => description.load()));

const support = noteMarkdown();
const parser = support.language.parser;

/**
 * Every node of a tree in document order, the nodes of its mounted trees
 * included, each with its name and its range.
 *
 * A fence language and the HTML of an HTML block mount their tree as an
 * overlay of the Markdown node, and a walk of the tree never enters an
 * overlay, so each one is walked here on its own, with the ranges it
 * covers.
 */
function nodesOf(tree: Tree, offset = 0): readonly string[] {
  const nodes: string[] = [];
  tree.iterate({
    enter: (node) => {
      const from = offset + node.from;
      const to = offset + node.to;
      nodes.push(`${node.name}:${String(from)}-${String(to)}`);
      const mounted = node.tree?.prop(NodeProp.mounted);
      if (mounted === undefined || mounted.overlay === null) return;
      const ranges = mounted.overlay
        .map(
          (range) => `${String(from + range.from)}-${String(from + range.to)}`,
        )
        .join(',');
      nodes.push(
        `[${ranges}]`,
        ...nodesOf(mounted.tree, from + (mounted.overlay[0]?.from ?? 0)),
      );
    },
  });
  return nodes;
}

/** The shape of a tree as one string, which two trees can compare. */
function shapeOf(tree: Tree): string {
  return nodesOf(tree).join(' ');
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
  // Record 0157. The live preview draws inline HTML between its tags and an
  // HTML block as quiet source, so both must parse the same in slices.
  'HTMLBlock',
  'HTMLTag',
  'CommentBlock',
  // The mounted trees: JavaScript and CSS and HTML fences, a script and a
  // style inside the HTML fence, an attribute of the HTML fence, and the
  // elements of an HTML block.
  'VariableDeclaration',
  'RuleSet',
  'Element',
  'Attribute',
  // Record 0171. Inline math on one dollar reads the text around each dollar,
  // so a formula, a price and an escaped dollar must parse the same in slices.
  'InlineMath',
] as const;

await test('the notes of the resume set hold every block syntax', () => {
  const found = new Set<string>();
  for (const doc of [corpusMarkdown, blockSyntaxMarkdown])
    for (const node of nodesOf(parser.parse(doc)))
      found.add(node.replace(/:.*$/, ''));
  for (const name of blockNodes) assert.ok(found.has(name), name);
});

await test('the note of block syntax mounts the tree of each kind of fence language', () => {
  // A Lezer language, a stream language and a language that mixes in HTML.
  const shape = shapeOf(parser.parse(blockSyntaxMarkdown));
  for (const name of ['FunctionDefinition', 'PhpOpen', 'Element'])
    assert.ok(shape.includes(`${name}:`), name);
  // A stream language names each token by its style, in lower case.
  assert.ok(/ comment:/.test(shape), 'the stream language of a shell fence');
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

for (const at of [33, 623]) {
  await test(`a completed note at offset ${String(at)} finishes its nested parses after the budget ends`, (t) => {
    const doc = blockSyntaxMarkdown;
    const whole = shapeOf(parser.parse(doc));
    const typed = parsedWhole(
      EditorState.create({ doc: doc.slice(0, at), extensions: [support] }),
    );
    // For this fixture, the wrapper and Markdown take 146 clock reads.
    // End the edit budget as the first fence language starts. The outer
    // tree covers the note, but the nested trees still need parse work.
    let reads = 0;
    const clock = t.mock.method(Date, 'now', () => (++reads <= 146 ? 0 : 100));
    let partial: EditorState;
    try {
      partial = typed.update({
        changes: { from: at, insert: doc.slice(at) },
      }).state;
    } finally {
      clock.mock.restore();
    }
    assert.equal(syntaxTree(partial).length, doc.length);
    assert.equal(syntaxTreeAvailable(partial), false);
    assert.notEqual(shapeOf(syntaxTree(partial)), whole);
    assert.throws(
      () => parsedWhole(partial, { attempts: 0 }),
      /the parser stopped at \d+ of \d+ characters/,
    );
    const completed = parsedWhole(partial);
    assert.equal(syntaxTreeAvailable(completed), true);
    assert.equal(
      shapeOf(syntaxTree(completed)),
      whole,
      `typed up to ${String(at)}`,
    );
  });
}

await test('the offline preview finishes the Markdown body after the budget ends', (t) => {
  const doc = blockSyntaxMarkdown;
  const whole = previewStructureOf(doc);
  assert.ok(whole.some((node) => node.kind === 'heading'));
  // One clock read before the nested-tree cases stops with a full-length
  // outer tree whose Markdown body has not yet been read.
  let reads = 0;
  const clock = t.mock.method(Date, 'now', () => (++reads <= 145 ? 0 : 100));
  try {
    assert.deepEqual(previewStructureOf(doc), whole);
  } finally {
    clock.mock.restore();
  }
});
