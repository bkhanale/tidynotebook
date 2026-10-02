/** The words of a copy action (record 0174). */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  copiedForMs,
  copyCodeWords,
  copyControlWords,
  type CopyState,
} from './copy-action.ts';

const states: readonly CopyState[] = ['ready', 'copied', 'selected'];

await test('the name of the copy action starts with its visible word in every state', () => {
  // Review of record 0174: the name stayed "Copy code" while the control
  // showed "Copied". A person who uses speech input says the word that the
  // control shows.
  for (const state of states)
    for (const label of ['Python', null]) {
      const words = copyControlWords(state, label);
      assert.equal(words.word, copyCodeWords[state]);
      assert.ok(words.name.startsWith(`${words.word} `), words.name);
    }
  assert.equal(new Set(Object.values(copyCodeWords)).size, states.length);
});

await test('the name says which code the control copies', () => {
  // Review of record 0174: every bar of a note had the one name "Copy code".
  assert.equal(copyControlWords('ready', 'Python').name, 'Copy Python code');
  assert.equal(copyControlWords('copied', 'Shell').name, 'Copied Shell code');
  assert.equal(
    copyControlWords('selected', 'cobol').name,
    'Selected cobol code',
  );
  assert.equal(copyControlWords('ready', null).name, 'Copy code');
  assert.equal(copyControlWords('ready', '').name, 'Copy code');
});

await test('a copy says that it copied, and a refusal says what to do', () => {
  assert.equal(copyControlWords('ready', null).announcement, '');
  assert.equal(
    copyControlWords('copied', null).announcement,
    'The code is on the clipboard.',
  );
  assert.match(
    copyControlWords('selected', null).announcement,
    /did not copy.*selected.*copy it with the keyboard/,
  );
});

await test('the confirmation stays for a short time', () => {
  assert.ok(copiedForMs >= 1000 && copiedForMs <= 3000);
});
