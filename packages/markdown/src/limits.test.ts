/**
 * The two resource limits of this package.
 *
 * A note is written by the one person who owns the deployment, so these
 * limits guard against an accident rather than against an attack: a pasted
 * dump that is larger than any note, and nesting deep enough to stop the
 * parser. Nothing here asserts a wall-clock duration. A timing assertion
 * measures the machine that runs it, and the test runner runs files in
 * parallel, so such an assertion fails for reasons that have nothing to do
 * with the code under test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAttachmentRefs, extractLinks } from './links.ts';
import { markdownLimits, MarkdownLimitError } from './limits.ts';
import { parseMarkdown } from './parse.ts';
import { renderMarkdown } from './render.ts';

/** Every public entry point of the package, by name. */
const entryPoints: ReadonlyArray<[string, (source: string) => unknown]> = [
  ['parseMarkdown', parseMarkdown],
  ['extractLinks', extractLinks],
  ['extractAttachmentRefs', extractAttachmentRefs],
  ['renderMarkdown', (source) => renderMarkdown(source)],
];

/** The limit error that `source` must produce at this entry point. */
async function refusal(
  call: (source: string) => unknown,
  source: string,
): Promise<MarkdownLimitError> {
  try {
    await call(source);
  } catch (thrown) {
    assert.ok(thrown instanceof MarkdownLimitError, String(thrown));
    return thrown;
  }
  assert.fail('the document was accepted');
}

/** As many whole copies of `text` as fit in `bytes`. */
function repeatTo(text: string, bytes: number): string {
  return text.repeat(Math.floor(bytes / text.length));
}

/** Ordinary prose of exactly `bytes` bytes, written as short paragraphs. */
function documentOfBytes(bytes: number): string {
  const body = repeatTo(
    'An ordinary sentence of prose with **strong** text and some `code`.\n' +
      'A second line of the same paragraph continues the thought here.\n\n',
    bytes,
  );
  return body + 'x'.repeat(bytes - body.length);
}

/** One line inside `levels` block quotes. */
function nested(levels: number): string {
  return `${'> '.repeat(levels)}deep\n`;
}

/** One line inside `levels` nested list items. */
function nestedList(levels: number): string {
  return `${'- '.repeat(levels)}deep\n`;
}

await test('a document at the byte limit is accepted', () => {
  const source = documentOfBytes(markdownLimits.maxInputBytes);
  assert.equal(source.length, markdownLimits.maxInputBytes);
  assert.equal(parseMarkdown(source).type, 'root');
});

await test('one byte above the limit is refused', async () => {
  const error = await refusal(
    parseMarkdown,
    `${documentOfBytes(markdownLimits.maxInputBytes)}x`,
  );
  assert.equal(error.reason, 'input-size');
  assert.equal(error.limit, markdownLimits.maxInputBytes);
  assert.equal(error.actual, markdownLimits.maxInputBytes + 1);
  assert.equal(
    error.message,
    `Markdown input is ${String(markdownLimits.maxInputBytes + 1)} bytes and the limit is ${String(markdownLimits.maxInputBytes)}.`,
  );
});

await test('the byte limit counts bytes and not characters', async () => {
  // Paragraphs of 31 two-byte characters. The document holds far fewer
  // characters than the cap and still exceeds it in bytes.
  const source = `${'é'.repeat(31)}\n\n`.repeat(16385);
  assert.ok(source.length < markdownLimits.maxInputBytes);
  const error = await refusal(parseMarkdown, source);
  assert.equal(error.reason, 'input-size');
  assert.ok(error.actual > markdownLimits.maxInputBytes);
});

await test('every entry point refuses a document above the byte limit', async () => {
  const source = `${documentOfBytes(markdownLimits.maxInputBytes)}x`;
  for (const [name, call] of entryPoints) {
    const error = await refusal(call, source);
    assert.equal(error.reason, 'input-size', name);
  }
});

await test('the nesting limit counts the levels an author wrote', () => {
  // The tree also holds the paragraph and its text, and a list holds a
  // wrapper node above each item. Neither counts, so exactly 100 written
  // levels of either kind are accepted.
  assert.equal(parseMarkdown(nested(100)).type, 'root');
  assert.equal(parseMarkdown(nestedList(100)).type, 'root');
});

await test('one nesting level above the limit is refused', async () => {
  const quotes = await refusal(parseMarkdown, nested(101));
  assert.equal(quotes.reason, 'nesting-depth');
  assert.equal(quotes.limit, markdownLimits.maxNestingDepth);
  assert.equal(quotes.actual, 101);
  const items = await refusal(parseMarkdown, nestedList(101));
  assert.equal(items.reason, 'nesting-depth');
  assert.equal(items.limit, markdownLimits.maxNestingDepth);
});

await test('nesting is refused before the parser reads the line', async () => {
  // A line of a million block quote markers never finished parsing. The
  // prefix scan stops at the limit, so the parser never sees it.
  for (const [name, call] of entryPoints) {
    const quotes = await refusal(call, `${'>'.repeat(1000000)} deep`);
    assert.equal(quotes.reason, 'nesting-depth', name);
    const items = await refusal(call, `${'- '.repeat(6000)}deep`);
    assert.equal(items.reason, 'nesting-depth', name);
  }
});

await test('indentation counts four columns as one level', async () => {
  const error = await refusal(
    parseMarkdown,
    `${' '.repeat((markdownLimits.maxNestingDepth + 1) * 4)}deep\n`,
  );
  assert.equal(error.reason, 'nesting-depth');
  assert.equal(error.actual, markdownLimits.maxNestingDepth + 1);
});

await test('a carriage return also ends a line for the prefix scan', async () => {
  const error = await refusal(parseMarkdown, `ordinary\r${nested(200)}`);
  assert.equal(error.reason, 'nesting-depth');
});

await test('a deeply nested tree is refused after parsing', async () => {
  // The prefix scan bounds one line. Repeated emphasis nests through inline
  // content instead, so this proves the tree guard still runs.
  const source = `${'*'.repeat(400)}x${'*'.repeat(400)}`;
  const error = await refusal(parseMarkdown, source);
  assert.equal(error.reason, 'nesting-depth');
  assert.ok(error.actual > markdownLimits.maxNestingDepth);
  await assert.rejects(renderMarkdown(source), MarkdownLimitError);
});

await test('an ordinary note is accepted and rendered', async () => {
  const source = [
    '# Notes',
    '',
    'A paragraph with **strong** text, a [link](https://example.com), and',
    'a second line.',
    '',
    '| Column | Right |',
    '| :----- | ----: |',
    '| cell   |     1 |',
    '',
    '- one',
    '  - two',
    '',
    '```ts',
    'const value = 1;',
    '```',
    '',
    '> quoted',
  ].join('\n');
  assert.equal(parseMarkdown(source).type, 'root');
  assert.match(await renderMarkdown(source), /<table>/);
});

await test('the package states two limits and nothing else', () => {
  assert.deepEqual(Object.keys(markdownLimits).sort(), [
    'maxInputBytes',
    'maxNestingDepth',
  ]);
});

await test('nested HTML is refused with the nesting error and never a stack error', async () => {
  // Review S2 of record 0157. An HTML block is one node of the Markdown
  // tree, so nested elements inside it passed the depth guard and the HTML
  // parse ran out of stack with a RangeError.
  for (const depth of [markdownLimits.maxNestingDepth + 1, 5000, 90000]) {
    const source = `${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}\n`;
    await assert.rejects(
      renderMarkdown(source),
      (error: unknown) =>
        error instanceof MarkdownLimitError && error.reason === 'nesting-depth',
      String(depth),
    );
  }
  // Unclosed tags nest as well, so they count the same.
  await assert.rejects(
    renderMarkdown(`${'<b>'.repeat(5000)}x\n`),
    (error: unknown) =>
      error instanceof MarkdownLimitError && error.reason === 'nesting-depth',
  );
  // HTML at the limit still renders.
  const depth = markdownLimits.maxNestingDepth;
  const html = await renderMarkdown(
    `${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}\n`,
  );
  assert.ok(html.includes('x'));
});
