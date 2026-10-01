/** The rule of Copy this note as Markdown in the command palette. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { copyNote, copyNoteMessages } from './copy-note.ts';

/** A clipboard that keeps what it takes and answers `works`. */
function clipboard(works: boolean): {
  readonly taken: string[];
  readonly copy: (text: string) => Promise<boolean>;
} {
  const taken: string[] = [];
  return {
    taken,
    copy: (text) => {
      taken.push(text);
      return Promise.resolve(works);
    },
  };
}

await test('the whole Markdown text of the note goes to the clipboard', async () => {
  const note =
    '# Plan\n\n- [ ] Write\n- [x] Read\n\n![map](../attachments/map.png)\n';
  const board = clipboard(true);
  assert.equal(await copyNote(note, board.copy), copyNoteMessages.copied);
  assert.deepEqual(board.taken, [note]);
});

await test('an empty note copies as an empty text', async () => {
  const board = clipboard(true);
  assert.equal(await copyNote('', board.copy), copyNoteMessages.copied);
  assert.deepEqual(board.taken, ['']);
});

await test('a page with no clipboard says so and names the other road', async () => {
  const board = clipboard(false);
  assert.equal(await copyNote('text', board.copy), copyNoteMessages.failed);
  assert.match(copyNoteMessages.failed, /Export as Markdown/);
});
