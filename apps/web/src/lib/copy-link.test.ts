import assert from 'node:assert/strict';
import test from 'node:test';
import { copyLinkMessages, copyNoteLink, noteAddress } from './copy-link.ts';

await test('the link of a note is the address of its screen', () => {
  assert.equal(
    noteAddress('https://notes.example', 'w1', 'n1'),
    'https://notes.example/w/w1/notes/n1',
  );
});

await test('a copy states its result in one sentence', async () => {
  const copied: string[] = [];
  assert.equal(
    await copyNoteLink('https://notes.example/w/w1/notes/n1', (text) => {
      copied.push(text);
      return Promise.resolve(true);
    }),
    copyLinkMessages.copied,
  );
  assert.deepEqual(copied, ['https://notes.example/w/w1/notes/n1']);
  assert.equal(
    await copyNoteLink('x', () => Promise.resolve(false)),
    copyLinkMessages.failed,
  );
});
