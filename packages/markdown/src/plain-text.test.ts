import assert from 'node:assert/strict';
import test from 'node:test';
import { plainExcerpt, type ExcerptText } from './plain-text.ts';

/** Splits a text with `[[` and `]]` around each marked word into parts. */
function parts(text: string): readonly ExcerptText[] {
  const result: ExcerptText[] = [];
  for (const [index, piece] of text.split(/\[\[|\]\]/).entries())
    if (piece !== '') result.push({ text: piece, marked: index % 2 === 1 });
  return result;
}

/** Writes parts back with `[[` and `]]` around each marked part. */
function written(excerpt: readonly ExcerptText[]): string {
  return excerpt
    .map((part) => (part.marked ? `[[${part.text}]]` : part.text))
    .join('');
}

/** The plain text of one marked source, written back with its marks. */
function plain(text: string): string {
  return written(plainExcerpt(parts(text)));
}

await test('emphasis marks go and the marked word stays marked', () => {
  // The defect this covers: a palette result showed `**` marks and whole
  // link addresses, because the excerpt was cut from the Markdown source.
  assert.equal(
    plain('The **[[budget]]** is _final_ now.'),
    'The [[budget]] is final now.',
  );
  assert.equal(plain('A ~~[[old]]~~ plan.'), 'A [[old]] plan.');
});

await test('a link keeps its label and loses its address', () => {
  assert.equal(
    plain('See [the [[budget]] plan](https://example.com/plans/budget).'),
    'See the [[budget]] plan.',
  );
  // A match inside the address leaves with the address.
  assert.equal(
    plain('Read [this](https://[[example]].com/a) now.'),
    'Read this now.',
  );
  // A bare address is what a reader sees, so it stays.
  assert.equal(
    plain('Open https://[[example]].com today.'),
    'Open https://[[example]].com today.',
  );
});

await test('block marks go and every block break stays visible', () => {
  // The defect this covers: a heading and the paragraph under it read as one
  // sentence, "Plan The budget is in the sheet."
  assert.equal(
    plain('# Plan\n\nThe [[budget]] is in the sheet.'),
    'Plan · The [[budget]] is in the sheet.',
  );
  assert.equal(
    plain('# Plan\n\n- one [[budget]] item\n- two\n\n> a quote\n\n---\n\nend'),
    'Plan · one [[budget]] item · two · a quote · end',
  );
  assert.equal(
    plain('| a | [[b]] |\n| - | - |\n| c | d |'),
    'a · [[b]] · c · d',
  );
  // After the end of a sentence the next block needs only a space.
  assert.equal(
    plain('The first one.\n\nThe [[second]] one'),
    'The first one. The [[second]] one',
  );
  // A line break is no block break.
  assert.equal(plain('one  \ntwo\nthree'), 'one two three');
  assert.equal(plain('- [ ] a [[task]]'), 'a [[task]]');
});

await test('code, math and the text of an image stay', () => {
  assert.equal(
    plain('Run `pnpm [[verify]]` first.'),
    'Run pnpm [[verify]] first.',
  );
  assert.equal(
    plain('![A [[budget]] chart](chart.png) here'),
    'A [[budget]] chart here',
  );
  assert.equal(plain('```sh\nls [[notes]]\n```'), 'ls [[notes]]');
  assert.equal(plain('Area $$\\pi r^2$$ is'), 'Area \\pi r^2 is');
});

await test('raw HTML and front matter go, and their text stays', () => {
  assert.equal(plain('A <b>[[bold]]</b> word<br>here'), 'A [[bold]] word here');
  assert.equal(plain('---\ntitle: x\n---\n\nBody [[text]]'), 'Body [[text]]');
  assert.equal(
    plain('A <b>bold</b> word\n\n<div>x</div>\n\nend'),
    'A bold word · end',
  );
});

await test('a value the parser changed keeps its marked words', () => {
  assert.equal(
    plain('Cost \\* [[budget]] &amp; time'),
    'Cost * [[budget]] & time',
  );
});

await test('the ellipsis of a window stays and the edges are trimmed', () => {
  assert.equal(
    plain('... the **[[budget]]** ... more text ...'),
    '... the [[budget]] ... more text ...',
  );
  assert.equal(plain('\n\n  [[word]]  \n'), '[[word]]');
});

await test('plain text comes back as it went in', () => {
  const text = parts('No marks at all, only [[words]] and more words.');
  assert.deepEqual(plainExcerpt(text), text);
  assert.deepEqual(plainExcerpt([]), []);
});

await test('a first block that repeats the note name goes', () => {
  // The excerpt is shown under the name of the note, so a first heading of
  // that name said it twice: "Plan" over "Plan The budget is in the sheet."
  const excerpt = parts('# Plan\n\nThe [[budget]] is in the sheet.');
  assert.equal(
    written(plainExcerpt(excerpt, { title: 'Plan' })),
    'The [[budget]] is in the sheet.',
  );
  // The comparison reads the words, not their case or their spaces.
  assert.equal(
    written(plainExcerpt(parts('#  my   PLAN\n\nText'), { title: 'My plan' })),
    'Text',
  );
  // The server cuts its headline at a word, after the `#` marks, so the
  // name is a line of its own there.
  assert.equal(
    written(plainExcerpt(parts('Plan\n\nThe [[budget]].'), { title: 'Plan' })),
    'The [[budget]].',
  );
  // A first line that only starts with the name is text of the note.
  assert.equal(
    written(plainExcerpt(parts('Plan for May.\n\nText'), { title: 'Plan' })),
    'Plan for May. Text',
  );
  // Front matter before the heading is no text of the note.
  assert.equal(
    written(
      plainExcerpt(parts('---\na: b\n---\n# Plan\n\nText'), { title: 'Plan' }),
    ),
    'Text',
  );
  // Another heading, a later heading, or no name keeps the heading.
  assert.equal(
    written(plainExcerpt(excerpt, { title: 'Budget' })),
    'Plan · The [[budget]] is in the sheet.',
  );
  assert.equal(
    written(plainExcerpt(parts('Intro.\n\n# Plan\n\nText'), { title: 'Plan' })),
    'Intro. Plan · Text',
  );
  assert.equal(
    written(plainExcerpt(excerpt)),
    'Plan · The [[budget]] is in the sheet.',
  );
  // A heading that is all the excerpt holds stays.
  assert.equal(
    written(plainExcerpt(parts('# [[Plan]]'), { title: 'Plan' })),
    '[[Plan]]',
  );
});
