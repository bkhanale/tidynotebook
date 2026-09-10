/** The domain code that a refused note produces. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkdownLimitError } from '@notesapp/markdown';
import { markdownLimitCode } from './markdown-limits.ts';

await test('a note above the byte limit is too large', () => {
  const error = new MarkdownLimitError('input-size', 1048576, 1048577);
  assert.equal(markdownLimitCode(error), 'note_too_large');
});

await test('a note above the nesting limit is too deep', () => {
  const error = new MarkdownLimitError('nesting-depth', 100, 101);
  assert.equal(markdownLimitCode(error), 'note_too_deep');
});

await test('any other value is not a Markdown limit', () => {
  for (const value of [null, undefined, 'text', 42, new Error('boom'), {}])
    assert.equal(markdownLimitCode(value), null);
});
