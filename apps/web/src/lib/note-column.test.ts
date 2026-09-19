import assert from 'node:assert/strict';
import test from 'node:test';
import { noteColumnClassName } from './note-column.ts';

await test('the text and the footer share one centred column', () => {
  const column = noteColumnClassName().split(' ');
  // Decision 0055. The measure is the one in the central theme, and the
  // editor centres its own lines on the same value.
  assert.ok(column.includes('mx-auto'));
  assert.ok(column.includes('w-full'));
  assert.ok(column.includes('max-w-note'));
});

await test('the column holds no name of its own', () => {
  // Decision 0069. The name is the last part of the breadcrumb, so nothing
  // here sets a title step or a title weight.
  const column = noteColumnClassName();
  assert.ok(!column.includes('text-3xl'));
  assert.ok(!column.includes('font-semibold'));
});
