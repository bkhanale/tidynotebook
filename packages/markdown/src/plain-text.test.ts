/**
 * Checks of the one plain text rule of Markdown (records 0162 and 0167).
 *
 * Search indexes this text and quotes it on the server and on the device, so
 * each case proves what a reader sees: the words stay, the marks and the
 * link addresses go, and two blocks never read as one sentence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLinks, indexNote } from './links.ts';
import { MarkdownLimitError, markdownLimits } from './limits.ts';
import { blockSeparator, readableText } from './plain-text.ts';

await test('emphasis marks go and their words stay', () => {
  // The defect this covers: a palette result showed `**` marks and whole
  // link addresses, because the excerpt was cut from the Markdown source.
  assert.equal(
    readableText('The **budget** is _final_, ~~old~~ and `coded` now.'),
    'The budget is final, old and coded now.',
  );
});

await test('a link keeps its label and loses its address', () => {
  assert.equal(
    readableText(
      'See [the plan](../plans/Plan.md) and [ref][r] now.\n\n[r]: https://example.com/hidden\n',
    ),
    'See the plan and ref now.',
  );
  assert.equal(
    readableText('Read [this](https://example.com/a) now.'),
    'Read this now.',
  );
  // A bare address is what a reader sees, so it stays.
  assert.equal(
    readableText('Open https://example.com today.'),
    'Open https://example.com today.',
  );
});

await test('block marks go and every block break stays visible', () => {
  // The defect this covers: a heading and the paragraph under it read as one
  // sentence, "Plan The budget is in the sheet."
  assert.equal(blockSeparator, ' · ');
  assert.equal(
    readableText('# Plan\n\nThe budget is in the sheet.'),
    'Plan · The budget is in the sheet.',
  );
  assert.equal(
    readableText('# Plan\n\n- one item\n- two\n\n> a quote\n\n---\n\nend'),
    'Plan · one item · two · a quote · end',
  );
  assert.equal(
    readableText('| a | b |\n| - | - |\n| c | d |'),
    'a · b · c · d',
  );
  // After the end of a sentence the next block needs only a space.
  assert.equal(
    readableText('The first one.\n\nThe second one'),
    'The first one. The second one',
  );
  // A line break is no block break.
  assert.equal(readableText('one  \ntwo\nthree'), 'one two three');
  assert.equal(readableText('- [ ] a task'), 'a task');
});

await test('code, math and the text of an image stay', () => {
  assert.equal(
    readableText('Run `pnpm verify` first.'),
    'Run pnpm verify first.',
  );
  assert.equal(
    readableText('![A budget chart](chart.png) here'),
    'A budget chart here',
  );
  assert.equal(readableText('```sh\nls notes\n```'), 'ls notes');
  assert.equal(readableText('Area $$\\pi r^2$$ is'), 'Area \\pi r^2 is');
  assert.equal(readableText('Inline \\(y\\) math.'), 'Inline y math.');
});

await test('raw HTML, front matter and a footnote mark go, and text stays', () => {
  assert.equal(readableText('A <b>bold</b> word<br>here'), 'A bold word here');
  assert.equal(readableText('---\ntitle: x\n---\n\nBody text'), 'Body text');
  assert.equal(
    readableText('A <b>bold</b> word\n\n<div>x</div>\n\nend'),
    'A bold word · end',
  );
  assert.equal(
    readableText('Text[^1] here.\n\n[^1]: The note.\n'),
    'Text here. The note.',
  );
});

await test('a value that the parser changed reads as the reader sees it', () => {
  assert.equal(
    readableText('Cost \\* budget &amp; time'),
    'Cost * budget & time',
  );
});

await test('an alert leaves its title in place of its marker', () => {
  assert.equal(
    readableText('> [!WARNING]\n> Keep the boat dry.\n'),
    'Warning · Keep the boat dry.',
  );
});

await test('white space at the edges goes', () => {
  assert.equal(readableText('\n\n  word  \n'), 'word');
  assert.equal(readableText(''), '');
});

await test('a first block that repeats the note name goes', () => {
  // The excerpt is shown under the name of the note, so a first heading of
  // that name said it twice: "Plan" over "Plan The budget is in the sheet."
  const note = '# Plan\n\nThe budget is in the sheet.';
  assert.equal(
    readableText(note, { title: 'Plan' }),
    'The budget is in the sheet.',
  );
  // The comparison reads the words, not their case or their spaces.
  assert.equal(
    readableText('#  my   PLAN\n\nText', { title: 'My plan' }),
    'Text',
  );
  // A first paragraph of the name alone goes as well.
  assert.equal(
    readableText('Plan\n\nThe budget.', { title: 'Plan' }),
    'The budget.',
  );
  // A first line that only starts with the name is text of the note.
  assert.equal(
    readableText('Plan for May.\n\nText', { title: 'Plan' }),
    'Plan for May. Text',
  );
  // Front matter before the heading is no text of the note.
  assert.equal(
    readableText('---\na: b\n---\n# Plan\n\nText', { title: 'Plan' }),
    'Text',
  );
  // Another heading, a later heading, or no name keeps the heading.
  assert.equal(
    readableText(note, { title: 'Budget' }),
    'Plan · The budget is in the sheet.',
  );
  assert.equal(
    readableText('Intro.\n\n# Plan\n\nText', { title: 'Plan' }),
    'Intro. Plan · Text',
  );
  assert.equal(readableText(note), 'Plan · The budget is in the sheet.');
  // A heading that is all the note holds stays.
  assert.equal(readableText('# Plan', { title: 'Plan' }), 'Plan');
});

await test('one parse gives the same links as extractLinks and the text', () => {
  const source = '# Today\n\nGo to [Plan](Plan.md) now.\n';
  const indexed = indexNote(source, 'notes/Today.md', { title: 'Today' });
  assert.deepEqual(indexed.links, extractLinks(source, 'notes/Today.md'));
  assert.equal(indexed.text, 'Go to Plan now.');
});

await test('a note over the limits is refused', () => {
  assert.throws(
    () => readableText('a'.repeat(markdownLimits.maxInputBytes + 1)),
    MarkdownLimitError,
  );
});
