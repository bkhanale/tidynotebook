/**
 * The literal links of GFM are the links of the step of remark-gfm, found in
 * time that grows with the note (record 0185).
 */
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { Paragraph, Root, Text } from 'mdast';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import remarkGfm from 'remark-gfm';
import { unified } from 'unified';
import {
  findLiteralLinks,
  literalLinks,
  remarkLinearLiteralLinks,
  type TreeStep,
} from './autolink-literals.ts';
import { parseMarkdown } from './parse.ts';

/** The step of remark-gfm that this module takes the place of. */
function gfmStep(): TreeStep {
  const [step] = gfmAutolinkLiteralFromMarkdown().transforms ?? [];
  assert.ok(step !== undefined);
  return step;
}

/** What the GFM step makes of one text, or `null` when it leaves it. */
function gfmLinks(value: string): Paragraph['children'] | null {
  const text: Text = { type: 'text', value };
  const paragraph: Paragraph = { type: 'paragraph', children: [text] };
  gfmStep()({ type: 'root', children: [paragraph] });
  const [only, ...others] = paragraph.children;
  return only === text && others.length === 0 ? null : paragraph.children;
}

/** A deterministic sequence of numbers below one, from a seed. */
function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/**
 * The pieces of a generated text: the characters that the rules of the step
 * read, in each case, with white space, punctuation, symbols and letters of
 * other scripts, half of a surrogate pair among them.
 */
const pieces = [
  'a',
  'Z',
  '0',
  '_',
  '-',
  '+',
  '.',
  '@',
  ':',
  '/',
  '://',
  'www',
  'WwW.',
  'http',
  'HTTPS://',
  'http://',
  's',
  ' ',
  '\t',
  '\n',
  '(',
  ')',
  '!',
  '"',
  '&',
  "'",
  ',',
  ';',
  '<',
  '>',
  '?',
  ']',
  '}',
  '*',
  '😀',
  'é',
  ' ',
  '—',
  '%',
  'co',
  '.com',
  'a@b.c',
  '\ud83d',
  '\ude00',
  '1.',
  'ſ',
  'K',
];

await test('the literal links of a text are the links of the GFM step', () => {
  const random = randomFrom(1);
  for (let index = 0; index < 20_000; index += 1) {
    let value = '';
    const length = 1 + Math.floor(random() * 40);
    for (let piece = 0; piece < length; piece += 1)
      value += pieces[Math.floor(random() * pieces.length)] ?? '';
    assert.deepEqual(literalLinks(value), gfmLinks(value), value);
  }
});

await test('the rules of web and mail addresses hold one by one', () => {
  const cases = [
    'see www.example.com.',
    'see https://example.com/a_(b)) now',
    'x:www.a.b and xwww.a.b',
    'mail me@example.org, or /you@example.org',
    'bad a@b.c- and a@b and a.b@c.d_',
    '(www.a.b)) and HTTP://A.B',
    'http://...',
    '😀a@b.co',
  ];
  for (const value of cases)
    assert.deepEqual(literalLinks(value), gfmLinks(value), value);
});

/** A tree of the shapes the step walks: nested phrasing, links, a table. */
function sampleTree(): Root {
  return {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'a www.a.b and ' },
          {
            type: 'emphasis',
            children: [{ type: 'text', value: 'me@a.org' }],
          },
          {
            type: 'link',
            url: 'u',
            children: [{ type: 'text', value: 'www.kept.as.is' }],
          },
          {
            type: 'linkReference',
            identifier: 'r',
            referenceType: 'full',
            children: [{ type: 'text', value: 'x@kept.too' }],
          },
          {
            type: 'text',
            value: 'plain',
            position: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 6, offset: 5 },
            },
          },
        ],
      },
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: 'https://a.b/c.' }],
      },
      {
        type: 'table',
        children: [
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'x www.c.d y' }],
              },
            ],
          },
        ],
      },
    ],
  };
}

await test('a tree takes the links of the GFM step, and a text in a link stays', () => {
  const expected = sampleTree();
  gfmStep()(expected);
  const actual = sampleTree();
  findLiteralLinks(actual);
  assert.deepEqual(actual, expected);
});

await test('the parser finds literal links with this step and no other', () => {
  const tree = parseMarkdown('Read www.example.com and me@example.org.\n');
  const paragraph = tree.children[0];
  assert.ok(paragraph?.type === 'paragraph');
  assert.deepEqual(
    paragraph.children
      .filter((node) => node.type === 'link')
      .map((node) => node.url),
    ['http://www.example.com', 'mailto:me@example.org'],
  );
  // A processor with no remark-gfm has no step to replace, and says so.
  assert.throws(() => unified().use(remarkLinearLiteralLinks).freeze());
  assert.doesNotThrow(() =>
    unified().use(remarkGfm).use(remarkLinearLiteralLinks).freeze(),
  );
});

/** The code units that `literalLinks` reads to find the links of `value`. */
function readsOf(value: string): number {
  const reads = mock.method(String.prototype, 'charCodeAt');
  try {
    literalLinks(value);
    return reads.mock.callCount();
  } finally {
    reads.mock.restore();
  }
}

await test('each text costs reads in proportion to its size', () => {
  // The review of 2026-10-03. The expressions of the GFM step scan again
  // from each place where a match may start, so a word of dots took the
  // square of its length, with no `@` in it, and a hundred thousand matches
  // in one text ran the step out of stack.
  const shapes = [
    'a.',
    'a-',
    'xwww.a',
    '.www',
    'xhttp://a',
    ' :www.a.b',
    ' a@b.co',
    'a@b.co,',
    'a.b@c.d-',
    '(http://a.b))',
  ];
  const size = 4000;
  for (const unit of shapes) {
    const once = readsOf(unit.repeat(size / unit.length));
    const twice = readsOf(unit.repeat((2 * size) / unit.length));
    assert.ok(twice <= 2.2 * once, `${unit}: ${String(once)} ${String(twice)}`);
  }
  const many = ' :www.a.b'.repeat(120_000);
  // A text and a link for each address, in one list of nodes.
  assert.equal(literalLinks(many)?.length, 240_000);
});
