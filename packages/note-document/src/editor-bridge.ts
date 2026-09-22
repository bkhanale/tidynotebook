/**
 * The private editor bridge (record 0082).
 *
 * The CodeMirror binding needs the live Yjs text and an undo manager, so this
 * entry returns Yjs types, and only `packages/editor` may import it
 * (`tools/check-boundaries.mjs`). The entry loads no CodeMirror code.
 *
 * The undo manager tracks no origin of its own. The binding adds the origin
 * of its local input, so remote work and repair never enter local undo.
 */
import * as Y from 'yjs';
import { noteTextRoot } from './document.ts';
import { liveDocumentOf, type DocumentSession } from './session.ts';

/** The live Yjs values that one editor view binds to. */
export type EditorBinding = {
  readonly text: Y.Text;
  readonly undoManager: Y.UndoManager;
};

/** The one binding of each session, so a view never gets a second undo. */
const bindings = new WeakMap<DocumentSession, EditorBinding>();

/**
 * The live text and the local undo manager of one session.
 *
 * One session has one binding. The session releases the undo manager when it
 * ends, so no view keeps an undo reference into a released document.
 */
export function editorBinding(session: DocumentSession): EditorBinding {
  const existing = bindings.get(session);
  if (existing !== undefined) return existing;
  const text = liveDocumentOf(session).getText(noteTextRoot);
  const undoManager = new Y.UndoManager(text, {
    trackedOrigins: new Set(),
  });
  const binding: EditorBinding = { text, undoManager };
  bindings.set(session, binding);
  session.onDestroy(() => {
    undoManager.destroy();
    bindings.delete(session);
  });
  return binding;
}
