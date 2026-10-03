/** Checks the searchable text of a note (record 0167). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkdownLimitError, markdownLimits } from '@notesapp/markdown';
import { noteTitle, searchableNote, searchTextRule } from './search-text.ts';

await test('the title is the last segment of the path without its suffix', () => {
  assert.equal(noteTitle('plans/2026/Launch.md'), 'Launch');
  assert.equal(noteTitle('Inbox.md'), 'Inbox');
});

await test('the body is the readable text and the links come from the same parse', () => {
  const indexed = searchableNote(
    '# Launch\nRead **the** [plan](Plan.md) at <https://example.com>.\n',
    'plans/Launch.md',
  );
  assert.equal(indexed.body, 'Read the plan at https://example.com.');
  assert.deepEqual(
    indexed.links.map((link) => link.targetPath),
    ['plans/Plan.md'],
  );
});

await test('a note over the limits of the grammar writes no row', () => {
  assert.throws(
    () =>
      searchableNote('a'.repeat(markdownLimits.maxInputBytes + 1), 'Big.md'),
    MarkdownLimitError,
  );
});

await test('a note whose HTML nests too deep writes no row and throws no stack error', () => {
  // The renderer refused 101 levels of HTML, and the text of search read
  // them: at 5000 levels a RangeError left the commit as a server fault and
  // stopped the search index migration, so the server did not start.
  for (const levels of [markdownLimits.maxNestingDepth + 1, 5000])
    assert.throws(
      () => searchableNote(`${'<div>'.repeat(levels)}x\n`, 'Deep.md'),
      (error: unknown) =>
        error instanceof MarkdownLimitError && error.reason === 'nesting-depth',
    );
});

await test('the rule of an earlier release is older than the current one', () => {
  // A row of release 0.12 reads the column default 0, so the migration
  // finds it only while the current rule is larger.
  assert.ok(searchTextRule > 0);
});
