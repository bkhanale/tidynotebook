/**
 * The sentence that a refused set of deletions shows.
 *
 * A deletion is one store operation, so one failure covers the whole set. The
 * message names the note when one note goes to Trash and a count when several
 * do, and it never prints a machine code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalStorageError } from '@notesapp/sync';
import { deleteFailureMessage } from './note-delete.ts';

await test('a refused deletion of one note names that note', () => {
  assert.equal(
    deleteFailureMessage([{ fileId: 'a', name: 'Plan' }], new Error('any')),
    'Plan did not move to Trash. Try again.',
  );
});

await test('a full device asks the person to free space', () => {
  assert.equal(
    deleteFailureMessage(
      [{ fileId: 'a', name: 'Plan' }],
      new LocalStorageError('quota', 'no space'),
    ),
    'Plan did not move to Trash. Free device space and try again.',
  );
});

await test('a refused deletion of several notes states a whole count', () => {
  assert.equal(
    deleteFailureMessage(
      [
        { fileId: 'a', name: 'One' },
        { fileId: 'b', name: 'Two' },
        { fileId: 'c', name: 'Three' },
      ],
      new Error('any'),
    ),
    '3 notes did not move to Trash. Try again.',
  );
});

await test('another local failure keeps the general sentence', () => {
  assert.equal(
    deleteFailureMessage(
      [{ fileId: 'a', name: 'Plan' }],
      new LocalStorageError('stale', 'the file changed'),
    ),
    'Plan did not move to Trash. Try again.',
  );
});
