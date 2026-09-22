import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import { startDocument } from './document.ts';
import { editorBinding } from './editor-bridge.ts';
import { openDocumentSession, type SessionChange } from './session.ts';

/** The origin that a binding gives its local input. */
const bindingOrigin = { binding: 'test' };

/** Types into a session the way the CodeMirror binding does. */
function typeInto(
  session: ReturnType<typeof openDocumentSession>,
  index: number,
  text: string,
): void {
  const { text: live } = editorBinding(session);
  live.doc?.transact(() => {
    live.insert(index, text);
  }, bindingOrigin);
}

await test('each change names its origin', () => {
  const base = startDocument('note');
  const here = openDocumentSession(base);
  const there = openDocumentSession(base);
  const seen: SessionChange['origin'][] = [];
  here.subscribe((change) => seen.push(change.origin));
  const sent: Uint8Array[] = [];
  there.subscribe((change) => sent.push(change.update));
  typeInto(there, 4, ' two');
  typeInto(here, 0, 'one ');
  assert.equal(here.applyRemote(Y.mergeUpdates(sent)).ok, true);
  sent.length = 0;
  typeInto(there, 0, '# ');
  assert.equal(here.applyRepair(Y.mergeUpdates(sent)).ok, true);
  assert.deepEqual(seen, ['local', 'remote', 'repair']);
  // The two inserts at the start are concurrent, so the client identities
  // order them. Either order holds both.
  assert.ok(
    ['one # note two', '# one note two'].includes(here.text()),
    here.text(),
  );
  here.destroy();
  there.destroy();
});

await test('two sessions that exchange their work hold one text', () => {
  const base = startDocument('shared\n');
  const a = openDocumentSession(base);
  const b = openDocumentSession(base);
  typeInto(a, 0, 'A ');
  typeInto(b, 7, 'B\n');
  assert.equal(a.applyRemote(b.encodeSince(a.stateVector())).ok, true);
  assert.equal(b.applyRemote(a.encodeSince(b.stateVector())).ok, true);
  assert.equal(a.text(), 'A shared\nB\n');
  assert.equal(b.text(), a.text());
  // Complete observed states agree once both hold the same work.
  assert.deepEqual(a.observe(), b.observe());
  a.destroy();
  b.destroy();
});

await test('local undo reverts local input and never remote work', () => {
  const base = startDocument('');
  const here = openDocumentSession(base);
  const there = openDocumentSession(base);
  const { undoManager } = editorBinding(here);
  undoManager.addTrackedOrigin(bindingOrigin);
  typeInto(here, 0, 'mine ');
  undoManager.stopCapturing();
  typeInto(there, 0, 'theirs ');
  assert.equal(here.applyRemote(there.encode()).ok, true);
  assert.ok(here.text().includes('mine '), here.text());
  undoManager.undo();
  assert.equal(here.text(), 'theirs ');
  assert.equal(undoManager.canUndo(), false);
  here.destroy();
  there.destroy();
});

await test('refused remote work changes nothing and announces nothing', () => {
  const base = startDocument('');
  const writer = new Y.Doc();
  Y.applyUpdate(writer, base);
  const updates: Uint8Array[] = [];
  writer.on('update', (update: Uint8Array) => updates.push(update));
  writer.getText('text').insert(0, 'one ');
  writer.getText('text').insert(4, 'two');
  const session = openDocumentSession(base);
  const seen: SessionChange[] = [];
  session.subscribe((change) => seen.push(change));
  const dependent = updates[1];
  assert.ok(dependent !== undefined);
  assert.deepEqual(session.applyRemote(dependent), {
    ok: false,
    refusal: 'missing-dependency',
  });
  assert.equal(session.text(), '');
  assert.deepEqual(seen, []);
  // The refused work is not pending inside the session.
  assert.equal(session.applyRemote(updates[0] ?? new Uint8Array()).ok, true);
  assert.equal(session.text(), 'one ');
  session.destroy();
});

await test('each session takes its own client identity', () => {
  const base = startDocument('a');
  const a = openDocumentSession(base);
  const b = openDocumentSession(base);
  assert.notEqual(
    editorBinding(a).text.doc?.clientID,
    editorBinding(b).text.doc?.clientID,
  );
  a.destroy();
  b.destroy();
});

await test('a destroyed session releases its listeners and its undo', () => {
  const session = openDocumentSession(startDocument('a'));
  const binding = editorBinding(session);
  assert.equal(editorBinding(session), binding);
  let calls = 0;
  session.subscribe(() => {
    calls += 1;
  });
  session.destroy();
  session.destroy();
  assert.equal(calls, 0);
  assert.throws(() => session.text(), /session has ended/);
  assert.throws(() => editorBinding(session), /session has ended/);
});
