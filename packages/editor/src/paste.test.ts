/**
 * HTML to Markdown paste checks.
 *
 * The converter parses text, not a DOM, so every case here runs without a
 * browser. Each test asserts the exact Markdown, because that text is what
 * the note stores.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { noteLinkSource } from './completion.ts';
import { noteMarkdown, parsedWhole } from './language.ts';
import {
  decodeEntities,
  htmlToMarkdown,
  isPastedUrl,
  normalizePastedUrl,
  pastedMarkdown,
} from './paste.ts';

await test('headings and paragraphs become Markdown blocks', () => {
  assert.equal(
    htmlToMarkdown('<h1>Title</h1><p>First line.</p><p>Second line.</p>'),
    '# Title\n\nFirst line.\n\nSecond line.',
  );
  assert.equal(htmlToMarkdown('<h3>Deep</h3>'), '### Deep');
});

await test('bold, italic, strike through and inline code convert', () => {
  assert.equal(
    htmlToMarkdown('<p>A <strong>bold</strong> and <em>soft</em> word.</p>'),
    'A **bold** and *soft* word.',
  );
  assert.equal(
    htmlToMarkdown('<p><del>gone</del> and <code>value</code></p>'),
    '~~gone~~ and `value`',
  );
});

await test('links and images keep their destination', () => {
  assert.equal(
    htmlToMarkdown('<p>See <a href="https://example.com/a">the page</a>.</p>'),
    'See [the page](https://example.com/a).',
  );
  assert.equal(
    htmlToMarkdown('<p><img src="/attachments/abc" alt="A chart"></p>'),
    '![A chart](/attachments/abc)',
  );
});

await test('a code block keeps its text and its language', () => {
  assert.equal(
    htmlToMarkdown(
      '<pre><code class="language-ts">const a = 1;\n</code></pre>',
    ),
    '```ts\nconst a = 1;\n```',
  );
  assert.equal(
    htmlToMarkdown('<pre>plain\ncode</pre>'),
    '```\nplain\ncode\n```',
  );
});

await test('a code block is not escaped as Markdown text', () => {
  assert.equal(
    htmlToMarkdown('<pre><code>a[b]*c*</code></pre>'),
    '```\na[b]*c*\n```',
  );
});

await test('lists convert and nest', () => {
  assert.equal(
    htmlToMarkdown('<ul><li>one</li><li>two</li></ul>'),
    '- one\n- two',
  );
  assert.equal(
    htmlToMarkdown('<ol><li>one</li><li>two</li></ol>'),
    '1. one\n2. two',
  );
  assert.equal(
    htmlToMarkdown('<ul><li>one<ul><li>deep</li></ul></li></ul>'),
    '- one\n  - deep',
  );
});

await test('a block quote prefixes every line', () => {
  assert.equal(
    htmlToMarkdown('<blockquote><p>one</p><p>two</p></blockquote>'),
    '> one\n>\n> two',
  );
});

await test('a table becomes a GFM table', () => {
  assert.equal(
    htmlToMarkdown(
      '<table><thead><tr><th>Name</th><th>Count</th></tr></thead>' +
        '<tbody><tr><td>alpha</td><td>2</td></tr></tbody></table>',
    ),
    '| Name | Count |\n| --- | --- |\n| alpha | 2 |',
  );
});

await test('a horizontal rule and a line break convert', () => {
  assert.equal(htmlToMarkdown('<p>a</p><hr><p>b</p>'), 'a\n\n---\n\nb');
  assert.equal(htmlToMarkdown('<p>a<br>b</p>'), 'a  \nb');
});

await test('script and style content never reaches the note', () => {
  assert.equal(
    htmlToMarkdown('<p>text</p><script>alert(1)</script><style>a{}</style>'),
    'text',
  );
});

await test('unknown tags contribute their text only', () => {
  assert.equal(
    htmlToMarkdown('<div class="x"><span>plain</span> text</div>'),
    'plain text',
  );
});

await test('Markdown characters in pasted text are escaped', () => {
  // The back ticks here are literal text, not a code element, so they are
  // escaped like every other Markdown character.
  assert.equal(
    htmlToMarkdown('<p>a * b [c] `d`</p>'),
    'a \\* b \\[c\\] \\`d\\`',
  );
});

await test('a dollar of pasted text stays a dollar', () => {
  // One dollar opens math (record 0171), so the text of a web page that
  // names a price range or a variable keeps each dollar as text.
  assert.equal(htmlToMarkdown('<p>from $a$ to $5</p>'), 'from \\$a\\$ to \\$5');
});

await test('entities decode', () => {
  assert.equal(
    decodeEntities('a &amp; b &lt;c&gt; &#65; &#x42;'),
    'a & b <c> A B',
  );
  assert.equal(htmlToMarkdown('<p>a &amp; b</p>'), 'a & b');
});

await test('white space collapses the way a browser renders it', () => {
  assert.equal(htmlToMarkdown('<p>a\n   b\tc</p>'), 'a b c');
});

await test('a full clipboard document keeps only its body', () => {
  assert.equal(
    htmlToMarkdown(
      '<html><head><title>Ignore</title></head><body><h2>Kept</h2></body></html>',
    ),
    '## Kept',
  );
});

await test('a pasted URL is recognised and completed', () => {
  assert.ok(isPastedUrl('https://example.com/a'));
  assert.ok(isPastedUrl('www.example.com'));
  assert.ok(!isPastedUrl('two words'));
  assert.ok(!isPastedUrl('example.com'));
  assert.equal(
    normalizePastedUrl('www.example.com'),
    'https://www.example.com',
  );
  assert.equal(
    normalizePastedUrl(' https://example.com '),
    'https://example.com',
  );
});

/** A note of the grammar with one other note, and the caret at `‸`. */
function pasteInto(text: string): EditorState {
  const at = text.indexOf('‸');
  return parsedWhole(
    EditorState.create({
      doc: text.replace('‸', ''),
      selection: { anchor: at },
      extensions: [
        noteMarkdown(),
        noteLinkSource({
          currentPath: 'notes/a.md',
          notes: [{ path: 'notes/a.md' }, { path: 'notes/Plan.md' }],
        }),
      ],
    }),
  );
}

await test('a plain paste in a paragraph links the notes that are there', () => {
  assert.equal(
    pastedMarkdown(pasteInto('Text ‸ more'), 'See [[Plan]].', ''),
    'See [Plan](Plan.md).',
  );
  // Text with no note to link pastes as the editor writes plain text.
  assert.equal(pastedMarkdown(pasteInto('Text ‸'), 'See [[Gone]].', ''), null);
});

await test('a plain paste inside code, math, HTML or a link keeps its brackets', () => {
  // Review of record 0172: only a fence kept the text, and every other
  // literal place took a link.
  for (const text of [
    'Code `a ‸ b` here.',
    'Math $a ‸ b$ here.',
    'Math $$a ‸ b$$ here.',
    '$$\nx ‸ y\n$$',
    '<div>\nsome ‸ words\n</div>',
    '    indented ‸ code',
    'A [label ‸ here](notes/x.md) link.',
    '```\n‸\n```',
  ])
    assert.equal(pastedMarkdown(pasteInto(text), '[[Plan]]', ''), null, text);
});

await test('a rich paste keeps the brackets of the page that it came from', () => {
  // The words of a page that shows `[[Plan]]` are those characters, so the
  // rich text keeps them escaped and links nothing.
  assert.equal(
    pastedMarkdown(
      pasteInto('‸'),
      '[[Plan]] here',
      '<p><b>[[Plan]]</b> here</p>',
    ),
    '**\\[\\[Plan\\]\\]** here',
  );
});
