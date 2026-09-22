import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import {
  applyDocumentUpdate,
  compactDocument,
  noteTextRoot,
  readDocumentText,
  startDocument,
} from './document.ts';
import { observeDocument, observedCoverage } from './observed.ts';

/** Records every update that a device writes. */
function recorder(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  return updates;
}

await test('compaction keeps identities, so old offline work still applies', () => {
  const base = startDocument('The quick brown fox\n');
  // A laptop goes offline with the starting state.
  const laptop = new Y.Doc();
  Y.applyUpdate(laptop, base);
  // The server takes many edits from a phone, with deletions, then compacts.
  const phone = new Y.Doc();
  Y.applyUpdate(phone, base);
  const written = recorder(phone);
  const text = phone.getText(noteTextRoot);
  for (let round = 0; round < 50; round += 1) {
    text.insert(text.length, `line ${String(round)}\n`);
    if (round % 3 === 0) text.delete(text.length - 8, 4);
  }
  const log = [base, ...written];
  const uncompacted = Y.mergeUpdates(log);
  const compacted = compactDocument(log);
  assert.equal(readDocumentText(compacted), text.toString());
  assert.ok(compacted.byteLength <= uncompacted.byteLength);
  // Equal rendered text is not the proof: the complete observed state is.
  assert.deepEqual(observeDocument(compacted), observeDocument(uncompacted));

  // The laptop edits the old text and comes back after the compaction.
  const offline = recorder(laptop);
  laptop.getText(noteTextRoot).insert(4, 'very ');
  laptop.getText(noteTextRoot).delete(15, 6);
  const accepted = applyDocumentUpdate(compacted, Y.mergeUpdates(offline));
  assert.ok(accepted.ok, accepted.ok ? '' : accepted.refusal);
  // The phone takes the same offline work and both hold one text.
  Y.applyUpdate(phone, Y.mergeUpdates(offline));
  assert.equal(accepted.value.text, text.toString());
  assert.ok(accepted.value.text.startsWith('The very quick '));
  assert.ok(!accepted.value.text.includes('brown'));
});

await test('a compacted document keeps the coverage answer of its source', () => {
  const base = startDocument('abc');
  const phone = new Y.Doc();
  Y.applyUpdate(phone, base);
  const written = recorder(phone);
  phone.getText(noteTextRoot).delete(1, 1);
  const log = [base, ...written];
  const seenBefore = { epoch: 3, state: observeDocument(base) };
  const compacted = compactDocument(log);
  assert.deepEqual(
    observedCoverage(seenBefore, { epoch: 3, document: compacted }),
    { ok: true, value: 'unseen-work' },
  );
  assert.deepEqual(
    observedCoverage(
      { epoch: 3, state: observeDocument(compacted) },
      { epoch: 3, document: Y.mergeUpdates(log) },
    ),
    { ok: true, value: 'covered' },
  );
});
