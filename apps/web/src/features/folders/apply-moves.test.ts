/**
 * The sentence that a refused set of moves shows.
 *
 * A move is one store operation, so one failure covers the whole set. The
 * message names the note when one note moves and a count when several do, and
 * it never prints a machine code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalStorageError } from '@notesapp/sync';
import { moveFailureMessage } from './apply-moves.ts';

await test('a refused move of one note names that note', () => {
  assert.equal(
    moveFailureMessage(
      [{ fileId: 'a', toPath: 'Work/Plan.md' }],
      new Error('any'),
    ),
    'Plan did not move. Try again.',
  );
});

await test('a full device asks the person to free space', () => {
  assert.equal(
    moveFailureMessage(
      [{ fileId: 'a', toPath: 'Work/Plan.md' }],
      new LocalStorageError('quota', 'no space'),
    ),
    'Plan did not move. Free device space and try again.',
  );
});

await test('a refused move of several notes states a whole count', () => {
  assert.equal(
    moveFailureMessage(
      [
        { fileId: 'a', toPath: 'Work/One.md' },
        { fileId: 'b', toPath: 'Work/Two.md' },
      ],
      new Error('any'),
    ),
    '2 notes did not move. Try again.',
  );
});

await test('another local failure keeps the general sentence', () => {
  assert.equal(
    moveFailureMessage(
      [{ fileId: 'a', toPath: 'Plan.md' }],
      new LocalStorageError('stale', 'the file changed'),
    ),
    'Plan did not move. Try again.',
  );
});
