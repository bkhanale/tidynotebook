/**
 * Corpus checks.
 *
 * These tests read the one shared document and assert specific structures in
 * the rendered HTML. They deliberately avoid a whole-document snapshot: a
 * snapshot would pass again after someone weakened the policy and updated the
 * expected text.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { corpusMarkdown } from '../test-data/content.ts';
import { extractAttachmentRefs, extractLinks } from './links.ts';
import { parseMarkdown } from './parse.ts';
import { renderMarkdown } from './render.ts';

const html = await renderMarkdown(corpusMarkdown);

await test('the corpus renders no script element and no unsafe HTML', () => {
  assert.ok(!html.includes('<script'));
  // GFM tagfilter: the script reads as the text that the author typed.
  assert.ok(html.includes("&#x3C;script>alert('raw block')&#x3C;/script>"));
  assert.ok(!html.includes('onclick'));
  // Record 0157. A safe element keeps its tags and loses every attribute that
  // the author list does not name.
  assert.ok(
    html.includes('Inline raw <b>bold text</b> and <span>span text</span>.'),
  );
});

await test('the corpus keeps the safe HTML elements and their words', () => {
  // Record 0157 and issue 235: each of these lost its meaning, and a line
  // break joined two words, when every HTML node was dropped.
  for (const kept of [
    '<kbd>Ctrl</kbd> + <kbd>S</kbd>',
    'H<sub>2</sub>O',
    'x<sup>2</sup>',
    '<mark>marked</mark>',
    'one<br>two',
    '<details>\n<summary>Folded title</summary>\n<p>Folded <em>body</em> text.</p>\n</details>',
  ])
    assert.ok(html.includes(kept), kept);
  // A raw link and an unknown element lose their tags and keep their words,
  // so a link never skips the URL policy and no word of the author is lost.
  assert.ok(html.includes('a raw link and kept words.'));
  assert.ok(!html.includes('example.com/raw'));
  assert.ok(!html.includes('unknown-tag'));
});

await test('the corpus renders no event handler attribute', () => {
  assert.ok(!/\son[a-z]+=/i.test(html));
  assert.ok(!html.includes('onerror'));
});

await test('the corpus renders no blocked URL scheme', () => {
  for (const scheme of ['javascript:', 'data:', 'vbscript:', 'file:'])
    assert.ok(!html.includes(scheme), scheme);
  assert.ok(!html.includes('//evil.example.com'));
});

await test('a blocked link keeps its text and loses its destination', () => {
  assert.ok(html.includes('<span data-blocked="link">click me</span>'));
  assert.ok(html.includes('<span data-blocked="link">broken note</span>'));
});

await test('an external link is marked and opens no named window', () => {
  assert.ok(
    html.includes(
      '<a href="https://example.com/page" rel="noopener noreferrer">external site</a>',
    ),
  );
  assert.ok(!html.includes('target='));
});

await test('an attachment image and an external image both render', () => {
  assert.ok(
    html.includes(
      '<img src="/attachments/0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d" alt="diagram attachment">',
    ),
  );
  // Decision 0067: an external picture keeps its address, sends no referrer,
  // and loads when the reader reaches it.
  assert.ok(
    html.includes(
      '<img src="https://example.com/photo.png" alt="external picture" loading="lazy" referrerpolicy="no-referrer">',
    ),
  );
  assert.ok(html.includes('<span data-blocked="image">bad image</span>'));
  assert.equal(html.match(/<img /g)?.length, 2);
});

await test('an alert states its tone and loses its marker', () => {
  assert.ok(
    html.includes(
      '<blockquote class="notes-alert" data-alert="warning"><p class="notes-alert-title">Warning</p>',
    ),
  );
  assert.ok(html.includes('An alert states its tone and hides its marker.'));
  assert.ok(!html.includes('[!WARNING]'));
});

await test('the corpus renders a GFM table with alignment', () => {
  assert.ok(html.includes('<th align="left">Column</th>'));
  assert.ok(html.includes('<th align="right">Right</th>'));
  assert.ok(html.includes('<td align="right">1</td>'));
});

/** The check mark that the renderer writes after the box of a task. */
const taskMark =
  '<svg class="notes-task-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

await test('task items render as disabled checkboxes with the check mark', () => {
  // Record 0033. The page draws the box from the theme and shows the mark
  // only while the box is checked, so every task carries the same mark.
  assert.ok(
    html.includes(
      `<li class="task-list-item"><input type="checkbox" checked disabled>${taskMark} finished task</li>`,
    ),
  );
  assert.ok(
    html.includes(
      `<li class="task-list-item"><input type="checkbox" disabled>${taskMark} open task</li>`,
    ),
  );
});

await test('nested lists render to their full depth', () => {
  assert.ok(html.includes('<li>level one'));
  assert.ok(html.includes('<li>level two'));
  assert.ok(html.includes('level three with a <a href="/notes/'));
});

await test('a footnote renders with a matching back reference', () => {
  assert.ok(
    html.includes(
      '<sup><a href="#user-content-fn-one" id="user-content-fnref-one" data-footnote-ref aria-describedby="footnote-label">1</a></sup>',
    ),
  );
  assert.ok(html.includes('<li id="user-content-fn-one">'));
  assert.ok(
    html.includes('<a href="#user-content-fnref-one" data-footnote-backref=""'),
  );
  assert.ok(html.includes('<section data-footnotes class="footnotes">'));
  // A double prefix here would point the back reference at nothing.
  assert.ok(!html.includes('user-content-user-content-'));
});

await test('front matter renders as document content', () => {
  assert.ok(
    html.includes(
      '<pre data-frontmatter="yaml">title: Corpus example\ntags: [demo, markdown]</pre>',
    ),
  );
  const types = new Set<string>();
  // The syntax tree is a plain object tree, so each node is checked before it
  // is read. A node of another shape adds no type and the test still fails.
  const collect = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    if ('type' in node && typeof node.type === 'string') types.add(node.type);
    if (!('children' in node)) return;
    const children: unknown = node.children;
    if (Array.isArray(children)) for (const child of children) collect(child);
  };
  collect(parseMarkdown(corpusMarkdown));
  assert.ok(types.has('yaml'));
  assert.ok(!types.has('toml'));
});

await test('math renders to sanitized KaTeX and diagrams stay source', () => {
  assert.ok(html.includes('class="notes-math notes-math-inline"'));
  // The three inline forms of the delimiter rule reach the math stage, so
  // the corpus holds three inline math spans and no leftover parenthesis
  // pair. The one dollar form opens by the rule of Pandoc (record 0171), so
  // the prices and the escaped dollar of the corpus stay text.
  assert.equal(
    html.split('class="notes-math notes-math-inline"').length - 1,
    3,
  );
  assert.ok(html.includes('Prices stay text: $5 and $10 today.'));
  assert.ok(html.includes('an escaped $x$ stays text.'));
  assert.ok(!html.includes('(a^2 + b^2 = c^2)'));
  assert.ok(html.includes('class="notes-math notes-math-display"'));
  assert.ok(html.includes('class="katex"'));
  assert.ok(!html.includes('<span data-math="inline">E = mc^2</span>'));
  assert.ok(html.includes('<pre data-diagram="mermaid">graph TD;\n  A-->B;'));
});

await test('a block quote nests and carries no presentation', () => {
  // The live preview draws the bar and the muted text of a quote. The
  // reference HTML carries the structure only, so a class or a style here
  // would be a second presentation of the same construct.
  const opening = html.match(/<blockquote[^>]*>/g) ?? [];
  assert.equal(opening.length, 4);
  // The alert of the corpus is the one quote that carries an attribute, and
  // it carries the tone alone.
  assert.deepEqual(
    opening.filter((tag) => tag !== '<blockquote>'),
    ['<blockquote class="notes-alert" data-alert="warning">'],
  );
  assert.equal((html.match(/<\/blockquote>/g) ?? []).length, 4);
  // The corpus quotes one quote inside another, so the reference path must
  // report two levels, exactly as the live preview reports two bars.
  let depth = 0;
  let deepest = 0;
  for (const tag of html.match(/<\/?blockquote[^>]*>/g) ?? []) {
    depth += tag.startsWith('</') ? -1 : 1;
    deepest = Math.max(deepest, depth);
  }
  assert.equal(deepest, 2);
});

await test('an unclosed fence renders as a highlighted code block', () => {
  assert.ok(
    html.includes(
      '<pre><code class="language-js"><span class="notes-code-keyword">const</span> unclosed <span class="notes-code-punctuation">=</span> <span class="notes-code-number">true</span><span class="notes-code-punctuation">;</span>\n</code></pre>',
    ),
  );
});

await test('text that looks like markup is escaped', () => {
  assert.ok(html.includes('5 &#x3C; 6 &#x26; 7 > 4'));
  assert.ok(html.includes('an escaped *star*'));
});

await test('a hard line break renders as a break element', () => {
  assert.ok(html.includes('A hard break ends this line<br>'));
});

await test('a soft line break draws a break inside its paragraph', () => {
  // Decision 0107. The two source lines of the first paragraph of the corpus
  // stay one paragraph, on two lines, like the hard break above.
  assert.ok(html.includes('escaped *star*.<br>\nUnicode: caf\u00e9'));
});

await test('Unicode renders exactly as written', () => {
  assert.ok(html.includes('caf\u00e9 in composed form'));
  assert.ok(html.includes('cafe\u0301 with a combining mark'));
  assert.ok(html.includes('\u{1F30D}'));
});

await test('parsing and rendering leave the source string untouched', async () => {
  const before = corpusMarkdown;
  parseMarkdown(corpusMarkdown);
  extractLinks(corpusMarkdown);
  extractAttachmentRefs(corpusMarkdown);
  await renderMarkdown(corpusMarkdown);
  assert.equal(corpusMarkdown, before);
  assert.equal(corpusMarkdown.length, before.length);
});

await test('the corpus parses to the same tree every time', () => {
  const first = JSON.stringify(parseMarkdown(corpusMarkdown));
  const second = JSON.stringify(parseMarkdown(corpusMarkdown));
  assert.equal(first, second);
});

await test('every top-level node maps onto its own source text', () => {
  const tree = parseMarkdown(corpusMarkdown);
  let previous = 0;
  for (const node of tree.children) {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    assert.ok(from !== undefined && to !== undefined, node.type);
    assert.ok(from >= previous, `${node.type} starts before the previous node`);
    assert.ok(to > from, `${node.type} has an empty range`);
    // Only white space separates one block from the next, so the offsets
    // address the original text and nothing was re-serialized.
    assert.equal(corpusMarkdown.slice(previous, from).trim(), '');
    previous = to;
  }
  assert.equal(corpusMarkdown.slice(previous).trim(), '');
});
