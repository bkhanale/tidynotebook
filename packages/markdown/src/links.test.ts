/**
 * Reference extraction checks.
 *
 * Ranges are asserted against offsets computed from the corpus text itself, so
 * a change to the corpus cannot silently invalidate an expectation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachmentIdA,
  corpusMarkdown,
  noteIdA,
  noteIdB,
} from '../test-data/content.ts';
import { extractAttachmentRefs, extractLinks } from './links.ts';

const links = extractLinks(corpusMarkdown);

/** The offset of a fragment that appears exactly once in the corpus. */
function offsetOf(fragment: string): number {
  const index = corpusMarkdown.indexOf(fragment);
  assert.notEqual(index, -1, `corpus is missing ${fragment}`);
  assert.equal(
    corpusMarkdown.indexOf(fragment, index + 1),
    -1,
    `corpus repeats ${fragment}`,
  );
  return index;
}

/** The reference that the corpus fragment `source` must produce. */
function expected(
  source: string,
  label: string,
  targetId: string | null,
): unknown {
  const from = offsetOf(source);
  return {
    range: { from, to: from + source.length },
    label,
    targetId,
    targetPath: null,
    source,
  };
}

await test('every reported range is an exact slice of the source', () => {
  for (const link of links)
    assert.equal(
      corpusMarkdown.slice(link.range.from, link.range.to),
      link.source,
    );
});

await test('references are reported in source order', () => {
  const offsets = links.map((link) => link.range.from);
  assert.deepEqual(
    offsets,
    [...offsets].sort((a, b) => a - b),
  );
});

await test('the corpus note links and definition are found', () => {
  assert.deepEqual(links, [
    expected(`[note link](/notes/${noteIdA})`, 'note link', noteIdA),
    expected(`[second note](/notes/${noteIdB})`, 'second note', noteIdB),
    expected(`[ref]: /notes/${noteIdB}`, 'ref', noteIdB),
    expected('[broken note](/notes/not-a-uuid)', 'broken note', null),
  ]);
});

await test('a malformed identifier is unresolved and never a target', () => {
  for (const source of [
    '[a](/notes/not-a-uuid)',
    '[a](/notes/3f2504e0-4f89-41d3-9a0c-0305e82c330)',
    '[a](/notes/00000000-0000-0000-0000-000000000000)',
    `[a](/notes/${noteIdA}/extra)`,
  ]) {
    const found = extractLinks(source);
    assert.equal(found.length, 1, source);
    assert.equal(found[0]?.targetId, null, source);
  }
});

await test('double bracket text is not a reference', () => {
  // Wiki syntax is not part of the language, so `[[Title]]` is plain text
  // everywhere it appears.
  assert.deepEqual(extractLinks('text [[A Title]] text'), []);
  assert.deepEqual(extractLinks('text [[Title|shown]] text'), []);
  assert.deepEqual(extractLinks('text `[[in code]]` text'), []);
  assert.deepEqual(extractLinks('    [[in an indented block]]\n'), []);
  assert.deepEqual(extractLinks('text \\[[escaped]] text'), []);
});

await test('a link that is not a note reference is ignored', () => {
  assert.deepEqual(extractLinks('[site](https://example.com)'), []);
  assert.deepEqual(extractLinks('[bad](javascript:alert(1))'), []);
  assert.deepEqual(extractLinks(`![image](/attachments/${attachmentIdA})`), []);
});

await test('an identifier in upper case is reported in lower case', () => {
  const found = extractLinks(`[a](/notes/${noteIdA.toUpperCase()})`);
  assert.equal(found[0]?.targetId, noteIdA);
});

await test('a stable note link keeps a safe heading fragment', () => {
  const found = extractLinks(`[a](/notes/${noteIdA}#heading_2)`);
  assert.equal(found[0]?.targetId, noteIdA);
});

await test('the corpus attachment image is found', () => {
  const image = `![diagram attachment](/attachments/${attachmentIdA})`;
  const from = offsetOf(image);
  assert.deepEqual(extractAttachmentRefs(corpusMarkdown), [
    {
      range: { from, to: from + image.length },
      revisionId: attachmentIdA,
      targetPath: null,
      source: image,
    },
  ]);
});

await test('a reference-style image is found through its definition', () => {
  const source = `![alt][pic]\n\n[pic]: /attachments/${attachmentIdA}\n`;
  const refs = extractAttachmentRefs(source);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.revisionId, attachmentIdA);
  assert.equal(refs[0]?.source, `[pic]: /attachments/${attachmentIdA}`);
});

await test('a malformed attachment identifier reports nothing', () => {
  assert.deepEqual(extractAttachmentRefs('![a](/attachments/nope)'), []);
  assert.deepEqual(
    extractAttachmentRefs('![a](https://example.com/a.png)'),
    [],
  );
});

await test('a byte order mark does not shift a reported range', () => {
  // The parser removes the mark before it assigns offsets, so every range
  // would be one character short without the correction.
  const body = `intro [note](/notes/${noteIdA}) and [second](/notes/${noteIdB}) end\n`;
  const source = `\ufeff${body}`;
  const found = extractLinks(source);
  assert.equal(found.length, 2);
  for (const link of found)
    assert.equal(source.slice(link.range.from, link.range.to), link.source);
  assert.equal(found[0]?.range.from, source.indexOf('[note]'));
  assert.equal(found[1]?.range.from, source.indexOf('[second]'));
  const images = extractAttachmentRefs(
    `\ufeff![a](/attachments/${attachmentIdA})\n`,
  );
  assert.equal(images[0]?.range.from, 1);
});

await test('portable note and attachment paths resolve from the source note', () => {
  const source =
    '[plan](../plan.md#work)\n\n![map](../../attachments/map%20one.png)\n';
  assert.equal(
    extractLinks(source, 'projects/active/today.md')[0]?.targetPath,
    'projects/plan.md',
  );
  assert.equal(
    extractAttachmentRefs(source, 'projects/active/today.md')[0]?.targetPath,
    'attachments/map one.png',
  );
});
