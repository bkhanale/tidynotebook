import assert from 'node:assert/strict';
import test from 'node:test';
import {
  excerptParts,
  nextResult,
  opensSearch,
  resultSentence,
  resultTitle,
} from './search-text.ts';
import { indexAddress } from './search-index.ts';

await test('an excerpt becomes text and marked text, never markup', () => {
  assert.deepEqual(
    excerptParts('Put an <mark>HTTPS</mark> proxy &amp; a <b>bold</b> &lt;tag&gt;'),
    [
      { text: 'Put an ', marked: false },
      { text: 'HTTPS', marked: true },
      { text: ' proxy & a bold <tag>', marked: false },
    ],
  );
  assert.deepEqual(excerptParts('<script>x</script>'), [
    { text: 'x', marked: false },
  ]);
  assert.deepEqual(excerptParts(''), []);
});

await test('the sentence states the count with a whole phrase', () => {
  assert.equal(resultSentence('', 0), '');
  assert.equal(resultSentence('  ', 4), '');
  assert.equal(
    resultSentence('backup', 0),
    'No page matches this search. Try another word.',
  );
  assert.equal(resultSentence('backup', 1), '1 result');
  assert.equal(resultSentence('backup', 3), '3 results');
});

const press = {
  key: '/',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  inField: false,
};

await test('slash opens the search outside a field, and Control K always', () => {
  assert.equal(opensSearch(press), true);
  assert.equal(opensSearch({ ...press, inField: true }), false);
  assert.equal(opensSearch({ ...press, key: 'k', ctrlKey: true }), true);
  assert.equal(
    opensSearch({ ...press, key: 'K', metaKey: true, inField: true }),
    true,
  );
  assert.equal(opensSearch({ ...press, key: 'k' }), false);
  assert.equal(
    opensSearch({ ...press, key: 'k', ctrlKey: true, altKey: true }),
    false,
  );
  assert.equal(opensSearch({ ...press, key: 'a' }), false);
});

await test('the arrow keys walk the results and stop at each end', () => {
  assert.equal(nextResult('ArrowDown', null, 3), 0);
  assert.equal(nextResult('ArrowDown', 1, 3), 2);
  assert.equal(nextResult('ArrowDown', 2, 3), 2);
  assert.equal(nextResult('ArrowUp', 2, 3), 1);
  assert.equal(nextResult('ArrowUp', 0, 3), null);
  assert.equal(nextResult('ArrowDown', null, 0), null);
  assert.equal(nextResult('Enter', 1, 3), 1);
});

await test('a result names its section when the section is not the page', () => {
  assert.equal(resultTitle('Self-hosting', 'Self-hosting'), 'Self-hosting');
  assert.equal(resultTitle('Self-hosting', ''), 'Self-hosting');
  assert.equal(resultTitle('Self-hosting', 'Mail'), 'Self-hosting: Mail');
});

await test('the index sits under the base path of the site', () => {
  assert.equal(indexAddress('/'), '/pagefind/pagefind.js');
  assert.equal(indexAddress('/notesapp/'), '/notesapp/pagefind/pagefind.js');
});
