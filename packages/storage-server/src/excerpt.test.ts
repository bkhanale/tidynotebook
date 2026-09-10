/** Checks the split of a marked search headline into contract parts. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  excerptStartMarker,
  excerptStopMarker,
  splitExcerpt,
} from './excerpt.ts';

/** Wraps one word in the markers that the search function writes. */
function marked(word: string): string {
  return `${excerptStartMarker}${word}${excerptStopMarker}`;
}

await test('a headline without a marker is one plain part', () => {
  assert.deepEqual(splitExcerpt('the durable queue'), [
    { text: 'the durable queue', marked: false },
  ]);
});

await test('an empty headline is an empty excerpt', () => {
  assert.deepEqual(splitExcerpt(''), []);
});

await test('every marked word becomes one marked part', () => {
  assert.deepEqual(
    splitExcerpt(`a ${marked('durable')} queue of ${marked('work')}.`),
    [
      { text: 'a ', marked: false },
      { text: 'durable', marked: true },
      { text: ' queue of ', marked: false },
      { text: 'work', marked: true },
      { text: '.', marked: false },
    ],
  );
});

await test('a marked word at the start needs no empty part before it', () => {
  assert.deepEqual(splitExcerpt(`${marked('run')} fast`), [
    { text: 'run', marked: true },
    { text: ' fast', marked: false },
  ]);
});

await test('the excerpt stays inside the length the contract carries', () => {
  const parts = splitExcerpt(`${marked('a'.repeat(2000))} tail`);
  assert.deepEqual(
    parts.map((part) => part.marked),
    [true],
  );
  assert.equal(parts[0]?.text.length, 1024);
});

await test('the excerpt stays inside the number of parts the contract carries', () => {
  const parts = splitExcerpt(`x ${marked('y')} `.repeat(200));
  assert.ok(parts.length <= 128, `${parts.length} parts`);
});
