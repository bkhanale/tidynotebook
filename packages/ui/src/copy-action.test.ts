/** The words of a copy action (record 0174). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { copiedForMs, copyCodeWords } from './copy-action.ts';

await test('the name of the copy action starts with its visible word', () => {
  // A person who uses speech input says the word that the control shows.
  assert.ok(copyCodeWords.name.startsWith(copyCodeWords.action));
  assert.notEqual(copyCodeWords.done, copyCodeWords.action);
});

await test('the confirmation stays for a short time', () => {
  assert.ok(copiedForMs >= 1000 && copiedForMs <= 3000);
});
