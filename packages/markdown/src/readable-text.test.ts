/**
 * Readable text checks (record 0167).
 *
 * Search matches and quotes this text, so each case proves what a reader
 * sees: the words stay, the marks and the link addresses go.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { indexNote, extractLinks } from './links.ts';
import { MarkdownLimitError, markdownLimits } from './limits.ts';
import { readableText } from './readable-text.ts';

await test('a mark of emphasis leaves its words and drops its signs', () => {
  assert.equal(
    readableText('A **bold**, *slanted*, ~~struck~~ and `coded` word.'),
    'A bold, slanted, struck and coded word.',
  );
});

await test('a link leaves its label and drops its address', () => {
  const text = readableText(
    'See [the plan](../plans/Plan.md), <https://example.com/a> and [ref][r].\n\n[r]: https://example.com/hidden\n',
  );
  assert.equal(text, 'See the plan, https://example.com/a and ref.');
  assert.ok(!text.includes('../plans'));
  assert.ok(!text.includes('hidden'));
});

await test('a picture leaves its alternative text', () => {
  assert.equal(
    readableText('Before ![A red boat](attachments/boat.png) after.'),
    'Before A red boat after.',
  );
});

await test('two blocks never run their words together', () => {
  assert.equal(
    readableText('# Title\nFirst line.\n\n- one\n- two\n\n> quoted\n'),
    'Title\nFirst line.\none\ntwo\nquoted',
  );
});

await test('a table row joins its cells with a space', () => {
  assert.equal(
    readableText('| Name | Size |\n| --- | --- |\n| Boat | Small |\n'),
    'Name Size\nBoat Small',
  );
});

await test('code and math keep their source', () => {
  assert.equal(
    readableText(
      '```ts\nconst boat = 1;\n```\n\n$$\nx^2\n$$\n\nInline \\(y\\).',
    ),
    'const boat = 1;\nx^2\nInline y.',
  );
});

await test('raw HTML, front matter and a footnote mark leave nothing', () => {
  assert.equal(
    readableText(
      '---\ntitle: Hidden\n---\n\n<div class="x">\n\nText[^1] <b>bold</b>.\n\n[^1]: The note.\n',
    ),
    'Text bold.\nThe note.',
  );
});

await test('an alert leaves its title in place of its marker', () => {
  assert.equal(
    readableText('> [!WARNING]\n> Keep the boat dry.\n'),
    'Warning\nKeep the boat dry.',
  );
});

await test('one parse gives the same links as extractLinks and the text', () => {
  const source = 'Go to [Plan](Plan.md) now.\n';
  const indexed = indexNote(source, 'notes/Today.md');
  assert.deepEqual(indexed.links, extractLinks(source, 'notes/Today.md'));
  assert.equal(indexed.text, 'Go to Plan now.');
});

await test('a note over the limits is refused', () => {
  assert.throws(
    () => readableText('a'.repeat(markdownLimits.maxInputBytes + 1)),
    MarkdownLimitError,
  );
});
