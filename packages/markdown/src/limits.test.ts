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

/** One paragraph holding exactly `count` inline delimiter characters. */
function inlineBlock(count: number): string {
  return '*a* '.repeat(count / 2);
}

/** A document of `count` blocks, each the smallest block that exists. */
function blocks(count: number): string {
  return 't\n=\n\n'.repeat(count);
}

/** A document of about `bytes` bytes made of `count` blocks. */
function blocksOfBytes(count: number, bytes: number): string {
  const filler = 'word '.repeat(
    Math.floor((Math.floor(bytes / count) - 2) / 5),
  );
  return `${filler}\n\n`.repeat(count);
}

/** A document holding about `count` inline delimiters, spread over blocks. */
function inlineDocument(count: number): string {
  const perBlock = markdownLimits.maxBlockInlineDelimiters;
  return `${inlineBlock(perBlock)}\n\n`.repeat(Math.floor(count / perBlock));
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
  [
    'one inline delimiter above the block cap',
    inlineBlock(markdownLimits.maxBlockInlineDelimiters + 2),
  ],
  [
    'inline delimiters above the document cap',
    inlineDocument(markdownLimits.maxInlineDelimiters + 2000),
  ],
  ['one block above the cap', blocks(markdownLimits.maxBlocks + 1)],
];

/**
 * The shapes a reviewer found after the first set of caps.
 *
 * Each one is either refused or renders inside the budget. The test prints
 * what happened, because which cap catches a shape is worth seeing.
 */
const adversarial: ReadonlyArray<[string, string]> = [
  ['alternating delimiters on one line', '*_ '.repeat(mebibyte / 3)],
  [
    'alternating delimiters in blocks',
    `${'*_ '.repeat(300)}\n\n`.repeat(Math.floor(mebibyte / 902)),
  ],
  ['emphasis dense at the block cap', '*a* '.repeat(16000)],
  ['50,000 setext headings', blocks(50000)],
  [
    'a fence opener that is really a paragraph',
    `\`\`\`a\`b\n${'| a | b |\n'.repeat(30000)}`,
  ],
  [
    'an unterminated fence before a table',
    `\`\`\`ts\n${'| a | b |\n'.repeat(30000)}`,
  ],
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

/** One line inside `levels` nested list items. */
function nestedList(levels: number): string {
  return `${'- '.repeat(levels)}deep\n`;
}

await test('the nesting limit counts the levels an author wrote', () => {
  // The tree also holds the paragraph and its text, and a list holds a wrapper
  // node above each item. Neither counts, so exactly 100 written levels of
  // either kind are accepted.
  assert.equal(parseMarkdown(nested(100)).type, 'root');
  assert.equal(parseMarkdown(nestedList(100)).type, 'root');
});

await test('one nesting level above the limit is refused for a list', async () => {
  const { error } = await refusal(parseMarkdown, nestedList(101));
  assert.equal(error.reason, 'nesting-depth');
  assert.equal(error.limit, markdownLimits.maxNestingDepth);
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

await test('a fence exempts the block caps and nothing else', async () => {
  // A fence opener must never turn a cap off for the rest of the document.
  const rows = `\`\`\`ts\n${'| a | b |\n'.repeat(markdownLimits.maxTableRows + 1)}`;
  assert.equal((await refusal(parseMarkdown, rows)).error.reason, 'table-rows');
  const items = `\`\`\`ts\n${'- item\n'.repeat(markdownLimits.maxListItems + 1)}`;
  assert.equal(
    (await refusal(parseMarkdown, items)).error.reason,
    'list-items',
  );
  const deep = `\`\`\`ts\n${nested(markdownLimits.maxNestingDepth + 1)}`;
  assert.equal(
    (await refusal(parseMarkdown, deep)).error.reason,
    'nesting-depth',
  );
  const long = `\`\`\`ts\n${'x'.repeat(markdownLimits.maxLineBytes + 1)}\n`;
  assert.equal(
    (await refusal(parseMarkdown, long)).error.reason,
    'line-length',
  );
});

await test('a backtick in an info string does not open a fence', async () => {
  // CommonMark calls this line a paragraph, so the block caps still apply.
  const source = `\`\`\`a\`b\n${'| a | b |\n'.repeat(markdownLimits.maxTableRows + 1)}`;
  const { error, elapsed } = await refusal(parseMarkdown, source);
  assert.equal(error.reason, 'table-rows');
  assert.ok(elapsed < 100, `the bypass took ${elapsed} ms`);
});

await test('a fence marker inside a list or a quote opens no fence', async () => {
  // The marker is recognized only at the start of a line, so the paragraph
  // that follows one of these still counts against the block caps.
  for (const prefix of ['- ', '> '])
    assert.throws(
      () => parseMarkdown(`${prefix}\`\`\`ts\n${paragraph(mebibyte / 2)}`),
      MarkdownLimitError,
    );
});

await test('a block holding too many inline delimiters is refused', async () => {
  const { error } = await refusal(
    parseMarkdown,
    inlineBlock(markdownLimits.maxBlockInlineDelimiters + 2),
  );
  assert.equal(error.reason, 'inline-delimiters');
  assert.equal(error.limit, markdownLimits.maxBlockInlineDelimiters);
});

await test('a document holding too many inline delimiters is refused', async () => {
  const { error } = await refusal(
    parseMarkdown,
    inlineDocument(markdownLimits.maxInlineDelimiters + 2000),
  );
  assert.equal(error.reason, 'inline-delimiters');
  assert.equal(error.limit, markdownLimits.maxInlineDelimiters);
});

await test('a document holding too many blocks is refused', async () => {
  const { error } = await refusal(
    parseMarkdown,
    blocks(markdownLimits.maxBlocks + 1),
  );
  assert.equal(error.reason, 'block-count');
  assert.equal(error.actual, markdownLimits.maxBlocks + 1);
});

await test('a table and a list each count as one block', () => {
  // Otherwise the block cap and the row cap would measure the same thing.
  assert.equal(parseMarkdown(table(markdownLimits.maxTableRows)).type, 'root');
  assert.equal(parseMarkdown(list(markdownLimits.maxListItems)).type, 'root');
});

for (const [name, source] of adversarial)
  await test(`${name} is refused or renders inside the budget`, async () => {
    const started = Date.now();
    let outcome = '';
    try {
      await renderMarkdown(source);
      outcome = `rendered in ${Date.now() - started} ms`;
    } catch (thrown) {
      assert.ok(thrown instanceof MarkdownLimitError, String(thrown));
      outcome = `refused as ${thrown.reason} in ${Date.now() - started} ms`;
    }
    const elapsed = Date.now() - started;
    console.log(`${name.padEnd(42)} ${outcome}`);
    assert.ok(elapsed < 2000, `${name} took ${elapsed} ms`);
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
  [
    'a block at the inline delimiter cap',
    inlineBlock(markdownLimits.maxBlockInlineDelimiters),
  ],
  [
    'a document at the inline delimiter cap',
    inlineDocument(markdownLimits.maxInlineDelimiters),
  ],
  ['minimal blocks at the block cap', blocks(markdownLimits.maxBlocks)],
  [
    '1 MiB of blocks at the block cap',
    blocksOfBytes(markdownLimits.maxBlocks, markdownLimits.maxInputBytes),
  ],
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
