/** The words of a failed local write on the open note. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalStorageErrorKind } from '@notesapp/sync';
import { localWriteFailed, localWriteFailureMessage } from './local-write.ts';

const failures: readonly LocalStorageErrorKind[] = [
  'aborted',
  'quota',
  'unavailable',
  'corrupt',
];

await test('every failed write has one sentence that says the text is not saved', () => {
  const sentences = failures.map((kind) => localWriteFailureMessage(kind));
  for (const [index, sentence] of sentences.entries()) {
    const kind = failures[index] ?? '';
    assert.ok(sentence !== null, kind);
    assert.match(sentence, /not saved/, kind);
    assert.equal(localWriteFailed(failures[index] ?? null), true, kind);
  }
  assert.equal(new Set(sentences).size, failures.length);
});

await test('a closed database asks the person to copy the text and reload', () => {
  // A second tab that opens the database at a newer version closes it here,
  // and every later write reports `unavailable`.
  const sentence = localWriteFailureMessage('unavailable') ?? '';
  assert.match(sentence, /Copy your text/);
  assert.match(sentence, /reload the tab/);
});

await test('no failure and a stale refusal show nothing', () => {
  assert.equal(localWriteFailureMessage(null), null);
  assert.equal(localWriteFailureMessage('stale'), null);
  assert.equal(localWriteFailed(null), false);
  assert.equal(localWriteFailed('stale'), false);
});

await test('a sentence names no engine, no code, and no dash', () => {
  for (const kind of failures) {
    const sentence = localWriteFailureMessage(kind) ?? '';
    assert.doesNotMatch(sentence, /IndexedDB|Dexie|quota|corrupt|[–—]/);
  }
});
