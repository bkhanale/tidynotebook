import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { openDocumentSession, startDocument } from '@notesapp/note-document';
import { documentBindingExtension } from './document-binding.ts';

await test('the binding builds a state over the live document text', () => {
  const session = openDocumentSession(startDocument('# Note\n'));
  const state = EditorState.create({
    doc: session.text(),
    extensions: [documentBindingExtension(session)],
  });
  assert.equal(state.doc.toString(), '# Note\n');
  session.destroy();
});
