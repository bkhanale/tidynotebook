import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceDocumentText, startDocument } from './document.ts';
import { observeDocument, observedCovers } from './observed.ts';

/** The document after one more write, or a test failure. */
function write(document: Uint8Array, text: string): Uint8Array {
  const written = replaceDocumentText(document, text);
  assert.ok(written.ok, written.ok ? '' : written.refusal);
  return written.value.document;
}

/** The observed state of one document in one generation. */
function seen(
  document: Uint8Array,
  epoch = 1,
): { readonly epoch: number; readonly state: Uint8Array } {
  return { epoch, state: observeDocument(document) };
}

await test('a later state of one document covers an earlier one', () => {
  const first = write(startDocument(''), 'One long paragraph\n');
  // The person divides the paragraph, which inserts and deletes.
  const later = write(first, 'One long\n\nparagraph\n');
  assert.equal(observedCovers(seen(later), seen(first)), true);
  assert.equal(observedCovers(seen(first), seen(first)), true);
});

await test('an earlier state covers no later insertion and no later deletion', () => {
  const first = write(startDocument(''), 'abc');
  const inserted = write(first, 'abcd');
  assert.equal(observedCovers(seen(first), seen(inserted)), false);
  // A deletion moves no state vector, so only the deletion set tells it.
  const deleted = write(first, 'ab');
  assert.equal(observedCovers(seen(first), seen(deleted)), false);
});

await test('the work of another document is not covered', () => {
  const one = write(startDocument(''), 'same text');
  const other = write(startDocument(''), 'same text');
  assert.equal(observedCovers(seen(one), seen(other)), false);
});

await test('two generations and a state that does not decode cover nothing', () => {
  const document = write(startDocument(''), 'text');
  assert.equal(observedCovers(seen(document, 2), seen(document, 1)), false);
  assert.equal(
    observedCovers(
      { epoch: 1, state: new Uint8Array([255, 255, 255]) },
      seen(document),
    ),
    false,
  );
});
