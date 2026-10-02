import assert from 'node:assert/strict';
import test from 'node:test';
import { headAfterChangeset } from './history-head.ts';

await test('the next restore names the head that the last restore made', () => {
  // Issue 254: a second restore named the head from before the first one,
  // and the server refused it.
  assert.equal(
    headAfterChangeset([{ revisionId: 'restored', fileId: 'note' }], 'note'),
    'restored',
  );
});

await test('the last revision of the file is its head', () => {
  assert.equal(
    headAfterChangeset(
      [
        { revisionId: 'first', fileId: 'note' },
        { revisionId: 'other', fileId: 'another' },
        { revisionId: 'second', fileId: 'note' },
      ],
      'note',
    ),
    'second',
  );
});

await test('a changeset of other files names no head of this one', () => {
  assert.equal(
    headAfterChangeset([{ revisionId: 'other', fileId: 'another' }], 'note'),
    null,
  );
});
