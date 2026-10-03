/**
 * The resource limits of this package (record 0182).
 *
 * A note can be written by a member of a workspace or by anybody who signs
 * up, and the server and every device parse it, so these limits keep the
 * work of a parse in proportion to the size of the note: a dump larger than
 * any note, nesting deep enough to stop the parser, an inline block of more
 * marks than any note holds, and more table cells than any note holds.
 * Nothing here asserts a wall-clock duration. A timing assertion measures
 * the machine that runs it, and the test runner runs files in parallel, so
 * such an assertion fails for reasons that have nothing to do with the code
 * under test. A limit is proved by a count instead.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAttachmentRefs, extractLinks, indexNote } from './links.ts';
import {
  inlineMarks,
  markdownLimits,
  MarkdownLimitError,
  measureLines,
} from './limits.ts';
import { lineLimits, parseMarkdown, withinParseLimits } from './parse.ts';
import { readableText } from './plain-text.ts';
import { renderMarkdown } from './render.ts';
import { mapRelativeReferences } from './rewrite.ts';

/** Every public entry point of the package, by name. */
const entryPoints: ReadonlyArray<[string, (source: string) => unknown]> = [
  ['parseMarkdown', parseMarkdown],
  ['extractLinks', extractLinks],
  ['extractAttachmentRefs', extractAttachmentRefs],
  ['indexNote', indexNote],
  ['readableText', readableText],
  [
    'mapRelativeReferences',
    (source) => mapRelativeReferences(source, 'note.md', () => null),
  ],
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
  // The prefix scan bounds one line, and the mark limit bounds one inline
  // block. Block quotes and emphasis inside them nest together, each within
  // its own limit, so this proves the tree guard still runs.
  const source = `${'> '.repeat(60)}${'*a '.repeat(50)}x${' b*'.repeat(50)}`;
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

await test('the package states four limits and nothing else', () => {
  assert.deepEqual(Object.keys(markdownLimits).sort(), [
    'maxBlockMarks',
    'maxInputBytes',
    'maxNestingDepth',
    'maxTableCells',
  ]);
});

/** A paragraph of exactly `marks` marks: links of two marks each. */
function paragraphOfMarks(marks: number): string {
  const links = 'a [link](u) '.repeat(Math.floor(marks / 2));
  return `${links}${marks % 2 === 1 ? '_x' : 'x'}\n`;
}

await test('a mark is a character that can open or close an inline construct', () => {
  assert.equal(inlineMarks('plain words, a b c.'), 0);
  assert.equal(inlineMarks('*a* _b_ ~~c~~ [d](e) $f$ <g>'), 13);
  // An escaped character is no mark, and the pairs of inline math are one.
  assert.equal(inlineMarks('\\* \\[ \\_'), 0);
  assert.equal(inlineMarks('\\(x\\)'), 2);
  assert.equal(inlineMarks(paragraphOfMarks(128)), 128);
});

await test('an inline block at the mark limit is read and one above it is refused', async () => {
  // The audit of 2026-10-02. micromark matches the marks of one inline block
  // against each other, so a short note of nested images or emphasis held a
  // server worker for seconds before the depth check refused it.
  const limit = markdownLimits.maxBlockMarks;
  for (const [name, call] of entryPoints) {
    assert.ok((await call(paragraphOfMarks(limit))) !== undefined, name);
    const error = await refusal(call, paragraphOfMarks(limit + 1));
    assert.equal(error.reason, 'block-marks', name);
    assert.equal(error.limit, limit, name);
    assert.equal(error.actual, limit + 1, name);
  }
  // A heading and a table cell are inline blocks of their own.
  const heading = `# ${paragraphOfMarks(limit + 1)}`;
  assert.equal((await refusal(parseMarkdown, heading)).reason, 'block-marks');
  const cell = `|a|b|\n|-|-|\n|${paragraphOfMarks(limit + 1).trim()}|c|\n`;
  assert.equal((await refusal(parseMarkdown, cell)).reason, 'block-marks');
});

await test('the shapes that grew with the square of their marks are refused', async () => {
  const shapes = [
    `${'!['.repeat(3000)}x${'](u)'.repeat(3000)}`,
    `${'*a '.repeat(3000)}x${' b*'.repeat(3000)}`,
    `${'*'.repeat(3000)}x${'*'.repeat(3000)}`,
    `x${']'.repeat(3000)}`,
    '\\('.repeat(3000),
    '$a '.repeat(3000),
    `a ${'<!-- '.repeat(3000)}`,
    `${'~~a '.repeat(3000)}x${' b~~'.repeat(3000)}`,
  ];
  for (const source of shapes) {
    const error = await refusal(parseMarkdown, source);
    assert.equal(error.reason, 'block-marks', source.slice(0, 12));
    await assert.rejects(renderMarkdown(source), MarkdownLimitError);
  }
});

await test('a part of many small blocks is read, because each block is within the limit', async () => {
  // The count of a part between blank lines only says that a block may be
  // over the limit. The parse of the blocks decides, so a long list, a
  // large table and a large code block are never refused for their marks.
  const limit = markdownLimits.maxBlockMarks;
  const item = paragraphOfMarks(limit - 8).trim();
  const list = Array.from({ length: 40 }, () => `- ${item}`).join('\n');
  const table = `|a|b|\n|-|-|\n${`|${item}|${item}|\n`.repeat(40)}`;
  const code = `\`\`\`\n${'*a[b]_c$<d>\n'.repeat(400)}\`\`\`\n`;
  const html = `<div>\n${'<p>*a* [b](c)</p>\n'.repeat(400)}</div>\n`;
  for (const source of [list, table, code, html]) {
    assert.ok(measureLines(source.split('\n')).partMarks > limit);
    assert.equal(lineLimits(source.split('\n')), 'unsure');
    assert.equal(withinParseLimits(source), true);
    assert.equal(parseMarkdown(source).type, 'root');
  }
});

/** A table of `lines` lines of one cell each: `|a|`, `|-|` and rows. */
function tableOfLines(lines: number, last = ''): string {
  return `|a|\n|-|\n${'|c|\n'.repeat(lines - 2)}${last}`;
}

await test('the table cells of a note at the limit are read and one above is refused', async () => {
  // The table extension keeps one list of edits for the whole note, so its
  // work grew with the square of the cells of all the tables together.
  // Each line of a table counts its pipes and itself.
  const limit = markdownLimits.maxTableCells;
  const lines = Math.floor(limit / 3);
  const atLimit = tableOfLines(lines, 'c\n'.repeat(limit - lines * 3));
  assert.equal(measureLines(atLimit.split('\n')).tableCells, limit);
  for (const [name, call] of entryPoints)
    assert.ok((await call(atLimit)) !== undefined, name);
  const above = `${atLimit}c\n`;
  for (const [name, call] of entryPoints) {
    const error = await refusal(call, above);
    assert.equal(error.reason, 'table-cells', name);
    assert.equal(error.limit, limit, name);
    assert.equal(error.actual, limit + 1, name);
  }
});

await test('the cells of every table of a note count together, and a row with no pipe counts', async () => {
  const small = '|a|b|\n|-|-|\n|c|d|\n\n';
  const many = small.repeat(Math.floor(markdownLimits.maxTableCells / 12) + 1);
  assert.equal((await refusal(parseMarkdown, many)).reason, 'table-cells');
  const bare = `|a|\n|-|\n${'c\n'.repeat(markdownLimits.maxTableCells)}`;
  assert.equal((await refusal(parseMarkdown, bare)).reason, 'table-cells');
  // A line that ends with a carriage return ends there, as in micromark.
  const crlf = bare.replaceAll('\n', '\r\n');
  assert.equal((await refusal(parseMarkdown, crlf)).reason, 'table-cells');
});

await test('the reading of the lines refuses a note with no copy of it', () => {
  // The editor reads the lines of its document on each change. The answer
  // is the answer of `withinParseLimits` whenever it is not unsure.
  const cases = [
    'A short note.\n',
    `${'> '.repeat(markdownLimits.maxNestingDepth + 1)}x`,
    tableOfLines(markdownLimits.maxTableCells),
    paragraphOfMarks(markdownLimits.maxBlockMarks + 1),
  ];
  assert.deepEqual(
    cases.map((source) => lineLimits(source.split('\n'))),
    ['within', 'outside', 'outside', 'unsure'],
  );
  assert.deepEqual(
    cases.map((source) => withinParseLimits(source)),
    [true, false, false, false],
  );
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
  // Unclosed tags nest as well, so they count the same. Inline tags are
  // marks of their paragraph too, so many of them meet the mark limit first.
  await assert.rejects(
    renderMarkdown(`${'<b>'.repeat(markdownLimits.maxNestingDepth + 1)}x\n`),
    (error: unknown) =>
      error instanceof MarkdownLimitError && error.reason === 'nesting-depth',
  );
  await assert.rejects(
    renderMarkdown(`${'<b>'.repeat(5000)}x\n`),
    (error: unknown) =>
      error instanceof MarkdownLimitError && error.reason === 'block-marks',
  );
  // HTML at the limit still renders.
  const depth = markdownLimits.maxNestingDepth;
  const html = await renderMarkdown(
    `${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}\n`,
  );
  assert.ok(html.includes('x'));
});

await test('every entry point refuses the nested HTML that the renderer refuses', async () => {
  // Only the renderer measured the HTML of a note. The plain text of search
  // read 500 levels and ran out of stack at 5000, so a commit failed with a
  // server fault and the search index migration stopped the server from
  // starting. The bound now holds in `parseMarkdown`, so every entry point
  // refuses the same notes with the same error.
  const depth = markdownLimits.maxNestingDepth;
  for (const levels of [depth + 1, 500, 5000, 60000])
    for (const source of [
      `${'<div>'.repeat(levels)}x\n`,
      `${'<div>'.repeat(levels)}x${'</div>'.repeat(levels)}\n`,
      `a ${'<span>'.repeat(levels)}x\n`,
      // The pieces of one note count together, in document order.
      `${'<div>\n\n'.repeat(levels)}x\n`,
    ])
      for (const [name, call] of entryPoints) {
        const error = await refusal(call, source);
        // Inline tags are marks of their paragraph, so past the mark limit
        // that limit refuses them first. An HTML block holds no inline block.
        const inline = source.startsWith('a ');
        const reason =
          inline && levels > markdownLimits.maxBlockMarks
            ? 'block-marks'
            : 'nesting-depth';
        assert.equal(error.reason, reason, name);
      }
  // A neutral tag is text in every reader, so it opens no level.
  const neutral = `${'<textarea>'.repeat(depth + 1)}x\n`;
  for (const [, call] of entryPoints) await call(neutral);
  // At the limit, every entry point reads the note.
  const atLimit = `${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}\n`;
  for (const [name, call] of entryPoints)
    assert.ok((await call(atLimit)) !== undefined, name);
});

await test('a surface asks whether the parse takes a note before it offers an action', () => {
  // Review of record 0174: a copy control stood on a note past the limits
  // and did nothing when pressed.
  assert.equal(withinParseLimits('```js\nx\n```\n'), true);
  assert.equal(
    withinParseLimits('a'.repeat(markdownLimits.maxInputBytes + 1)),
    false,
  );
  assert.equal(
    withinParseLimits(`${'> '.repeat(markdownLimits.maxNestingDepth + 1)}x`),
    false,
  );
  assert.equal(
    withinParseLimits(paragraphOfMarks(markdownLimits.maxBlockMarks + 1)),
    false,
  );
});
