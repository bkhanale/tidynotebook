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

await test('a note above the mark or the cell limit has a code of its own', () => {
  // Record 0182. Each limit of the grammar names its own cause, so the
  // author reads what to change.
  assert.equal(
    markdownLimitCode(new MarkdownLimitError('block-marks', 128, 129)),
    'note_too_many_marks',
  );
  assert.equal(
    markdownLimitCode(new MarkdownLimitError('table-cells', 10000, 10001)),
    'note_too_many_cells',
  );
});

await test('any other value is not a Markdown limit', () => {
  for (const value of [null, undefined, 'text', 42, new Error('boom'), {}])
    assert.equal(markdownLimitCode(value), null);
});
