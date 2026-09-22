/**
 * The binding of one live note document to one editor view (record 0082).
 *
 * The CodeMirror binding reads the live Yjs text and the local undo manager
 * through the private bridge of `packages/note-document`. It gives its own
 * input a transaction origin that the undo manager tracks, so remote work and
 * repair never enter local undo. `create-editor.ts` joins this extension to
 * the one view of an open working copy in a later change.
 */
import type { Extension } from '@codemirror/state';
import type { DocumentSession } from '@notesapp/note-document';
import { editorBinding } from '@notesapp/note-document/editor-bridge';
import { yCollab } from 'y-codemirror.next';

/** The extension that binds one session to the view that holds it. */
export function documentBindingExtension(session: DocumentSession): Extension {
  const binding = editorBinding(session);
  return yCollab(binding.text, null, { undoManager: binding.undoManager });
}
