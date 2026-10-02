import assert from 'node:assert/strict';
import test from 'node:test';
import { maxListedFiles, maxNoteListFiles, maxPageSize } from './read.ts';

await test('the list of a notes area holds more than one export archive', () => {
  // Issue 256: the list of the area stopped at maxListedFiles, so a
  // workspace of 1010 notes showed 1000 of them.
  assert.ok(maxNoteListFiles > maxListedFiles);
  // One export archive holds 65535 entries at the most.
  assert.ok(maxNoteListFiles > 0xffff);
});

await test('the list of a notes area stops on a page boundary', () => {
  assert.equal(maxNoteListFiles % maxPageSize, 0);
});
