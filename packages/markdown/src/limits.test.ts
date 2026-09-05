/**
 * Resource limit checks.
 *
 * A note is untrusted input, so the cost of reading one must depend on its
 * size and on nothing else. These tests use the documents that made the parser
 * take seconds or never finish, and they assert both the refusal and the time
 * it takes, because a guard that is itself slow does not bound anything.
 *
 * The second half is the calibration. It builds every capped shape at exactly
 * its cap, renders it, and prints the measurement. A cap is only worth its
 * value if the document it still admits renders quickly, so the numbers here
 * are the evidence for the values in `markdownLimits`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAttachmentRefs, extractLinks } from './links.ts';
import { markdownLimits, MarkdownLimitError } from './limits.ts';
import { parseMarkdown } from './parse.ts';
import { renderMarkdown } from './render.ts';

/** One mebibyte, the largest document this package accepts. */
const mebibyte = 1024 * 1024;

/** Every public entry point of the package, by name. */
const entryPoints: ReadonlyArray<[string, (source: string) => unknown]> = [
  ['parseMarkdown', parseMarkdown],
  ['extractLinks', extractLinks],
  ['extractAttachmentRefs', extractAttachmentRefs],
  ['renderMarkdown', (source) => renderMarkdown(source)],
];

/**
 * The limit error that `source` must produce, and the time it took.
 *
 * A synchronous entry point throws and an asynchronous one rejects, so both
 * are awaited here and both are timed the same way.
 */
async function refusal(
  call: (source: string) => unknown,
  source: string,
): Promise<{ error: MarkdownLimitError; elapsed: number }> {
  const started = Date.now();
  try {
    await call(source);
  } catch (thrown) {
    const elapsed = Date.now() - started;
    assert.ok(thrown instanceof MarkdownLimitError, String(thrown));
    return { error: thrown, elapsed };
  }
  assert.fail('the document was accepted');
}

/** As many whole copies of `text` as fit in `bytes`. */
function repeatTo(text: string, bytes: number): string {
  return text.repeat(Math.floor(bytes / text.length));
}

/** A GFM table of `rowLines` lines, including its header and its rule. */
function table(rowLines: number): string {
  const rows = ['| Column | Right |', '| :----- | ----: |'];
  for (let index = 0; index < rowLines - 2; index += 1)
    rows.push(`| cell ${index} | ${index} |`);
  return `${rows.join('\n')}\n`;
}

/** A bullet list of `items` lines. */
function list(items: number): string {
  const out: string[] = [];
  for (let index = 0; index < items; index += 1)
    out.push(`- item number ${index}`);
  return `${out.join('\n')}\n`;
}

/** A document of `count` paragraphs, each holding one link. */
function links(count: number): string {
  const out: string[] = [];
  for (let index = 0; index < count; index += 1)
    out.push(`A [link ${index}](https://example.com/${index}) here.`);
  return `${out.join('\n\n')}\n`;
}

/** One line inside `levels` block quotes. */
function nested(levels: number): string {
  return `${'> '.repeat(levels)}deep\n`;
}

/** Ordinary prose of about `bytes` bytes, written as short paragraphs. */
function prose(bytes: number): string {
  return repeatTo(
    'An ordinary sentence of prose with **strong** text and some `code`.\n' +
      'A second line of the same paragraph continues the thought here.\n\n',
    bytes,
  );
}

/** One fenced code block of about `bytes` bytes. */
function codeFence(bytes: number): string {
  const open = '```ts\n';
  const close = '```\n';
  const body = repeatTo(
    'const value = compute(index) + offset * 2; // ordinary\n',
    bytes - open.length - close.length,
  );
  return `${open}${body}${close}`;
}

/** One paragraph of about `bytes` bytes, with no blank line inside it. */
function paragraph(bytes: number): string {
  return repeatTo(
    'An ordinary sentence of prose with plain text and words in it.\n',
    bytes,
  );
}

/** A document of exactly `bytes` bytes, as 64 byte paragraphs. */
function documentOfBytes(bytes: number): string {
  return `${'x'.repeat(62)}\n\n`.repeat(bytes / 64);
}

/**
 * The documents that made the parser take seconds or never finish.
 *
 * The measured times before these caps existed were 16 seconds for the first,
 * 205 seconds for the second, no result at all for the third, 83 seconds for
 * the table, 12 seconds for the list, and 12 seconds for the one paragraph.
 */
const hostile: ReadonlyArray<[string, string]> = [
  ['80 KB of link openings', `${'['.repeat(40000)}x${']'.repeat(40000)}`],
  ['200 KB of link openings', `${'['.repeat(100000)}x${']'.repeat(100000)}`],
  ['a line of one million quote markers', `${'>'.repeat(1024 * 1024)} x`],
  ['6000 nested quotes', `${'>'.repeat(6000)} deep`],
  ['6000 nested quotes with spaces', `${'> '.repeat(6000)}deep`],
  ['6000 nested list items', `${'- '.repeat(6000)}deep`],
  ['6000 nested ordered items', `${'1. '.repeat(6000)}deep`],
  ['a line above the line limit', 'x'.repeat(100 * 1024)],
  ['one table row above the cap', table(markdownLimits.maxTableRows + 1)],
  ['one list line above the cap', list(markdownLimits.maxListItems + 1)],
  ['one link opening above the cap', links(markdownLimits.maxLinkOpenings + 1)],
  [
    'one nesting level above the cap',
    nested(markdownLimits.maxNestingDepth + 1),
  ],
  ['a paragraph above the cap', paragraph(mebibyte)],
  ['a document above the byte cap', `${documentOfBytes(mebibyte)}x`],
];

for (const [name, source] of hostile)
  await test(`${name} is refused in under 100 ms`, async () => {
    const { error, elapsed } = await refusal(parseMarkdown, source);
    assert.ok(
      elapsed < 100,
      `${name} took ${elapsed} ms and reported ${error.reason}`,
    );
  });

await test('every entry point refuses a document nested 6000 levels deep', async () => {
  for (const [name, call] of entryPoints)
    for (const source of [
      `${'>'.repeat(6000)} deep`,
      `${'- '.repeat(6000)}deep`,
    ]) {
      const { error } = await refusal(call, source);
      assert.equal(error.name, 'MarkdownLimitError', name);
    }
});

await test('every entry point refuses an oversized table and list', async () => {
  for (const [name, call] of entryPoints) {
    const rows = await refusal(call, table(markdownLimits.maxTableRows + 1));
    assert.equal(rows.error.reason, 'table-rows', name);
    const items = await refusal(call, list(markdownLimits.maxListItems + 1));
    assert.equal(items.error.reason, 'list-items', name);
  }
});

await test('the nesting limit counts the levels an author wrote', () => {
  // The tree also holds the root, the paragraph, and its text. Those are
  // subtracted, so exactly 100 written levels are accepted.
  assert.equal(parseMarkdown(nested(100)).type, 'root');
});

await test('one nesting level above the limit is refused', async () => {
  const { error } = await refusal(parseMarkdown, nested(101));
  assert.equal(error.reason, 'nesting-depth');
  assert.equal(error.limit, markdownLimits.maxNestingDepth);
  assert.equal(error.actual, 101);
});

await test('a deeply nested tree is refused after parsing', async () => {
  // The pre-scan bounds one line prefix. Repeated emphasis nests through
  // inline content instead, so this proves the tree guard still runs.
  const source = `${'*'.repeat(400)}x${'*'.repeat(400)}`;
  const { error } = await refusal(parseMarkdown, source);
  assert.equal(error.reason, 'nesting-depth');
  assert.ok(error.actual > markdownLimits.maxNestingDepth);
  await assert.rejects(renderMarkdown(source), MarkdownLimitError);
});

await test('a delimiter run above the limit is refused', async () => {
  const { error } = await refusal(
    parseMarkdown,
    `text ${'~'.repeat(markdownLimits.maxDelimiterRun + 1)} text`,
  );
  assert.equal(error.reason, 'delimiter-run');
  assert.equal(error.limit, markdownLimits.maxDelimiterRun);
});

await test('a delimiter run at the limit is accepted', () => {
  const source = `text ${'~'.repeat(markdownLimits.maxDelimiterRun)} text`;
  assert.equal(parseMarkdown(source).type, 'root');
});

await test('a line above the byte limit is refused', async () => {
  const { error } = await refusal(
    parseMarkdown,
    'x'.repeat(markdownLimits.maxLineBytes + 1),
  );
  assert.equal(error.reason, 'line-length');
  assert.equal(error.actual, markdownLimits.maxLineBytes + 1);
});

await test('a document above the byte limit is refused', async () => {
  const { error } = await refusal(
    parseMarkdown,
    `${documentOfBytes(markdownLimits.maxInputBytes)}x`,
  );
  assert.equal(error.reason, 'input-size');
  assert.equal(error.limit, markdownLimits.maxInputBytes);
  assert.equal(error.actual, markdownLimits.maxInputBytes + 1);
});

await test('the byte limit counts bytes and not characters', async () => {
  // Paragraphs of 31 two-byte characters. The document holds far fewer
  // characters than the cap and still exceeds it in bytes.
  const source = `${'\u00e9'.repeat(31)}\n\n`.repeat(16385);
  assert.ok(source.length < markdownLimits.maxInputBytes);
  const { error } = await refusal(parseMarkdown, source);
  assert.equal(error.reason, 'input-size');
  assert.ok(error.actual > markdownLimits.maxInputBytes);
});

await test('a code fence is exempt from the paragraph cap', () => {
  // A long fence is cheap, because its content is never read as inline text.
  const source = codeFence(mebibyte / 2);
  assert.equal(parseMarkdown(source).type, 'root');
  // The same bytes outside a fence are one paragraph and are refused.
  assert.throws(
    () => parseMarkdown(paragraph(mebibyte / 2)),
    MarkdownLimitError,
  );
});

/** Every capped shape, built at exactly its cap. */
const calibration: ReadonlyArray<[string, string]> = [
  ['a table at the row cap', table(markdownLimits.maxTableRows)],
  ['a list at the line cap', list(markdownLimits.maxListItems)],
  ['links at the opening cap', links(markdownLimits.maxLinkOpenings)],
  ['nesting at the depth cap', nested(markdownLimits.maxNestingDepth)],
  ['a paragraph at the block cap', paragraph(markdownLimits.maxBlockBytes)],
  ['prose at the byte cap', prose(markdownLimits.maxInputBytes)],
  ['a code fence at the byte cap', codeFence(markdownLimits.maxInputBytes)],
];

for (const [name, source] of calibration)
  await test(`${name} renders inside the time budget`, async () => {
    const started = Date.now();
    const html = await renderMarkdown(source);
    const elapsed = Date.now() - started;
    console.log(
      `${name.padEnd(30)} ${String(source.length).padStart(8)} bytes  ${elapsed} ms`,
    );
    assert.ok(html.length > 0);
    // The measurement above is the point of this test. The bound is loose
    // because the runner runs test files in parallel, and it exists to catch a
    // return to the earlier cost, which was measured in tens of seconds.
    assert.ok(elapsed < 2000, `${name} took ${elapsed} ms`);
  });
