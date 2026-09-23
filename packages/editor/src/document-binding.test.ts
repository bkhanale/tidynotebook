import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import {
  encodeDocumentDelta,
  openDocumentSession,
  replaceDocumentText,
  startDocument,
  type DocumentSession,
} from '@notesapp/note-document';
import { bindDocument, remoteWorkGate } from './document-binding.ts';

/** The work that another device would send for one text of a note. */
function otherWork(session: DocumentSession, text: string): Uint8Array {
  const written = replaceDocumentText(session.encode(), text);
  if (!written.ok) throw new Error(written.refusal);
  return encodeDocumentDelta(written.value.document, session.stateVector());
}

await test('the binding builds a state over the live document text', () => {
  const session = openDocumentSession(startDocument('# Note\n'));
  const binding = bindDocument(session);
  const state = EditorState.create({
    doc: session.text(),
    extensions: [binding.extension],
  });
  assert.equal(state.doc.toString(), '# Note\n');
  binding.release();
  session.destroy();
});

await test('remote work reaches the document when nothing composes', () => {
  const session = openDocumentSession(startDocument('# Note\n'));
  const binding = bindDocument(session);
  const applied = binding.applyRemote(otherWork(session, '# Note\nmore\n'));
  assert.equal(applied.ok, true);
  assert.equal(applied.ok ? applied.value : '', 'applied');
  assert.ok(session.text().includes('more'), session.text());
  binding.release();
  session.destroy();
});

await test('remote work waits for the end of a composition', () => {
  const session = openDocumentSession(startDocument('# Note\n'));
  const gate = remoteWorkGate(session);
  gate.compositionStarted();
  const held = gate.applyRemote(otherWork(session, '# Note\nremote\n'));
  assert.equal(held.ok, true);
  assert.equal(held.ok ? held.value : '', 'held');
  assert.equal(session.text(), '# Note\n');

  gate.compositionEnded();
  assert.ok(session.text().includes('remote'), session.text());
  session.destroy();
});

await test('two updates of one composition reach the document together', () => {
  const session = openDocumentSession(startDocument('# Note\n'));
  const gate = remoteWorkGate(session);
  const first = otherWork(session, '# Note\nfirst\n');
  gate.compositionStarted();
  gate.applyRemote(first);
  // The second update follows the first, so the two merge into one and the
  // gate holds one value however long the composition runs.
  gate.applyRemote(
    (() => {
      const after = openDocumentSession(session.encode());
      after.applyRemote(first);
      const work = otherWork(after, '# Note\nfirst\nsecond\n');
      after.destroy();
      return work;
    })(),
  );
  assert.equal(session.text(), '# Note\n');
  gate.compositionEnded();
  const text = session.text();
  assert.ok(text.includes('first'), text);
  assert.ok(text.includes('second'), text);
  session.destroy();
});

await test('a released gate applies the work it still holds', () => {
  const session = openDocumentSession(startDocument('# Note\n'));
  const gate = remoteWorkGate(session);
  gate.compositionStarted();
  gate.applyRemote(otherWork(session, '# Note\nlate\n'));
  gate.release();
  assert.ok(session.text().includes('late'), session.text());
  session.destroy();
});

await test('local undo never takes remote work', () => {
  const session = openDocumentSession(startDocument('# Note\n'));
  const binding = bindDocument(session);
  const state = EditorState.create({
    doc: session.text(),
    extensions: [binding.extension],
  });
  assert.equal(state.doc.toString(), '# Note\n');
  const origins: string[] = [];
  const stop = session.subscribe((change) => origins.push(change.origin));
  binding.applyRemote(otherWork(session, '# Note\nremote\n'));
  stop();
  assert.deepEqual(origins, ['remote']);
  session.destroy();
});
