/**
 * Resource limit checks.
 *
 * A note is untrusted input, so the cost of reading one must depend on its
 * size and on nothing else. These tests use the documents that made the parser
 * take seconds or never finish, and they assert both the refusal and the time
 * it takes, because a guard that is itself slow does not bound anything.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { noteIdA } from '../test-data/content.ts';
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

/** A document of `count` copies of `text`, each on its own line. */
function lines(text: string, count: number): string {
  return `${text}\n`.repeat(count);
}

/**
 * The documents that made the parser take seconds or never finish.
 *
 * The measured times before the pre-scan existed were 16 seconds for the first
 * one, 205 seconds for the second, and no result at all for the third.
 */
const hostile: ReadonlyArray<[string, string]> = [
  ['80 KB of link openings', `${'['.repeat(40000)}x${']'.repeat(40000)}`],
  ['200 KB of link openings', `${'['.repeat(100000)}x${']'.repeat(100000)}`],
  ['a line of one million quote markers', `${'>'.repeat(1024 * 1024)} x`],
  ['6000 nested quotes', `${'>'.repeat(6000)} deep`],
  ['6000 nested quotes with spaces', `${'> '.repeat(6000)}deep`],
  ['6000 nested list items', `${'- '.repeat(6000)}deep`],
  ['6000 nested ordered items', `${'1. '.repeat(6000)}deep`],
  ['20001 link openings', lines('[a]', 20001)],
  ['a line above the line limit', 'x'.repeat(100 * 1024)],
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

await test('a line that opens more than 100 blocks is refused', async () => {
  const { error } = await refusal(parseMarkdown, `${'> '.repeat(101)}deep`);
  assert.equal(error.reason, 'nesting-depth');
  assert.equal(error.limit, markdownLimits.maxNestingDepth);
  assert.equal(error.actual, 101);
});

await test('a moderately nested document is accepted', () => {
  // Both guards target 100 levels, and the tree adds the paragraph and its
  // text on top of the block quotes, so a document must stay below that.
  const tree = parseMarkdown(`${'> '.repeat(50)}deep`);
  assert.equal(tree.type, 'root');
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

await test('a document above the link opening limit is refused', async () => {
  const { error } = await refusal(
    parseMarkdown,
    lines('[a]', markdownLimits.maxLinkOpenings + 1),
  );
  assert.equal(error.reason, 'link-count');
  assert.equal(error.limit, markdownLimits.maxLinkOpenings);
});

await test('a line above the byte limit is refused', async () => {
  const { error } = await refusal(
    parseMarkdown,
    'x'.repeat(markdownLimits.maxLineBytes + 1),
  );
  assert.equal(error.reason, 'line-length');
  assert.equal(error.actual, markdownLimits.maxLineBytes + 1);
});

await test('a document exactly at the byte limit renders', async () => {
  // Lines of 64 bytes, so the whole document is exactly at the cap.
  const source = lines('x'.repeat(63), markdownLimits.maxInputBytes / 64);
  assert.ok((await renderMarkdown(source)).includes('<p>'));
});

await test('a document above the byte limit is refused', async () => {
  const source = `${lines('x'.repeat(63), markdownLimits.maxInputBytes / 64)}x`;
  const { error } = await refusal(parseMarkdown, source);
  assert.equal(error.reason, 'input-size');
  assert.equal(error.limit, markdownLimits.maxInputBytes);
  assert.equal(error.actual, markdownLimits.maxInputBytes + 1);
});

await test('the byte limit counts bytes and not characters', async () => {
  // Lines of 32 two-byte characters. The document holds far fewer characters
  // than the cap and still exceeds it in bytes.
  const source = lines('\u00e9'.repeat(32), 32264);
  assert.ok(source.length < markdownLimits.maxInputBytes);
  const { error } = await refusal(parseMarkdown, source);
  assert.equal(error.reason, 'input-size');
  assert.ok(error.actual > markdownLimits.maxInputBytes);
});

/** An ordinary note of about `bytes` bytes: prose, lists, tables, and code. */
function ordinaryDocument(bytes: number): string {
  const parts: string[] = [];
  let size = 0;
  let index = 0;
  while (size < bytes) {
    const chunk = [
      `## Section ${index}`,
      '',
      `An ordinary paragraph with **strong** text, a [note link](/notes/${noteIdA}),`,
      'an external [site](https://example.com/page), and some `inline code`.',
      '',
      '- first item',
      '  - nested item',
      '- [x] a finished task',
      '',
      '| Column | Right |',
      '| :----- | ----: |',
      `| cell   | ${index} |`,
      '',
      '```ts',
      `const value = ${index};`,
      '```',
      '',
      '> A quoted line with a footnote reference style link.',
      '',
    ].join('\n');
    parts.push(chunk);
    size += chunk.length;
    index += 1;
  }
  return parts.join('');
}

await test('an ordinary document of 1 MiB renders inside the time budget', async () => {
  const source = ordinaryDocument(1024 * 1024);
  const started = Date.now();
  const html = await renderMarkdown(source);
  const elapsed = Date.now() - started;
  console.log(
    `1 MiB ordinary document: ${source.length} bytes rendered in ${elapsed} ms`,
  );
  assert.ok(html.includes('<table>'));
  // The measurement is printed above; this bound is deliberately generous.
  // The test runner runs test files in parallel, so the wall clock here
  // depends on the rest of the suite: about 3 seconds for this file alone and
  // about 8 seconds inside the full run on the development machine. The
  // assertion exists to catch a return to the earlier cost, which took 205
  // seconds for 200 KB and would take many minutes for this document.
  assert.ok(elapsed < 30000, `rendering took ${elapsed} ms`);
});
