/**
 * The text of a template note on this device and on the server.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalCachedNote } from '@notesapp/sync';
import { readNoteText } from './note-text.ts';

/** One cached note of this device. */
function cached(text: string, deleted = false): LocalCachedNote {
  return {
    fileId: 'template',
    path: 'Templates/Groceries.md',
    text,
    deleted,
    sequence: 1,
    baseRevisionId: null,
    stale: false,
    acceptedText: null,
    acceptedPath: null,
    acceptedRevisionId: null,
    document: null,
  };
}

/** A store that holds one cached note, or none. */
function storeWith(note: LocalCachedNote | null) {
  return { readCachedNote: () => Promise.resolve(note) };
}

/** A server read that must not run. */
const unused = (): Promise<never> =>
  Promise.reject(new Error('The server was read with a copy on the device.'));

await test('the copy of this device answers first', async () => {
  assert.equal(
    await readNoteText(storeWith(cached('# Rice')), 'a', 'w', 'f', unused),
    '# Rice',
  );
});

await test('a note in Trash on this device reads from the server', async () => {
  assert.equal(
    await readNoteText(storeWith(cached('old', true)), 'a', 'w', 'f', () =>
      Promise.resolve('# From the server'),
    ),
    '# From the server',
  );
});

await test('a read with no connection is a text the device cannot read', async () => {
  // The read of the server throws with no network. The caller then states
  // its one sentence, so a daily note or an insert never fails in silence.
  assert.equal(
    await readNoteText(storeWith(null), 'a', 'w', 'f', () =>
      Promise.reject(new TypeError('Failed to fetch')),
    ),
    null,
  );
  // A store that fails reads the server instead.
  const broken = {
    readCachedNote: () => Promise.reject(new Error('IndexedDB is closed.')),
  };
  assert.equal(
    await readNoteText(broken, 'a', 'w', 'f', () => Promise.resolve('# Kept')),
    '# Kept',
  );
});
