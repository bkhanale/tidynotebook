/**
 * The binding of one live note document to one editor view (record 0082).
 *
 * The CodeMirror binding reads the live Yjs text and the local undo manager
 * through the private bridge of `packages/note-document`. It gives its own
 * input a transaction origin that the undo manager tracks, so remote work and
 * repair never enter local undo.
 *
 * Remote work reaches the document through this binding and never through the
 * session directly, because an update that lands during an IME composition
 * would move the text under the composing range and lose the composed
 * characters. The gate below holds that work while the view composes and
 * applies it at composition end. The held work stays one merged update, so a
 * long composition cannot grow an unbounded queue.
 *
 * One session has one binding, and the binding ends with the view: `release`
 * applies whatever it still holds and stops holding anything else. The
 * session itself belongs to the caller that opened the note.
 */
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import {
  mergeDocumentUpdates,
  type DocumentResult,
  type DocumentSession,
} from '@notesapp/note-document';
import { editorBinding } from '@notesapp/note-document/editor-bridge';
import {
  yCollab,
  ySyncAnnotation,
  yUndoManagerKeymap,
} from 'y-codemirror.next';

/** Where remote work waits while the view composes. */
export type RemoteWorkGate = {
  /**
   * Applies accepted remote work, or holds it until the composition ends.
   *
   * `applied` states that the document took the work. `held` states that the
   * document takes it as soon as the composition ends.
   */
  applyRemote(update: Uint8Array): DocumentResult<'applied' | 'held'>;
  /** States that a composition started, so work waits from now on. */
  compositionStarted(): void;
  /** States that the composition ended and applies the work it held. */
  compositionEnded(): void;
  /** Applies held work and stops holding. The session stays open. */
  release(): void;
};

/** The gate that decides when remote work reaches one open document. */
export function remoteWorkGate(session: DocumentSession): RemoteWorkGate {
  let composing = false;
  let held: Uint8Array | null = null;

  const flush = (): void => {
    const pending = held;
    held = null;
    // A refusal leaves the document exactly as it was. The next snapshot
    // repairs a device that cannot take the work.
    if (pending !== null) session.applyRemote(pending);
  };

  return {
    applyRemote(update: Uint8Array): DocumentResult<'applied' | 'held'> {
      if (composing) {
        held = held === null ? update : mergeDocumentUpdates([held, update]);
        return { ok: true, value: 'held' };
      }
      const applied = session.applyRemote(update);
      if (!applied.ok) return applied;
      return { ok: true, value: 'applied' };
    },
    compositionStarted(): void {
      composing = true;
    },
    compositionEnded(): void {
      composing = false;
      flush();
    },
    release(): void {
      composing = false;
      flush();
    },
  };
}

/**
 * Whether one view update carries work that came from the document.
 *
 * The binding annotates every transaction that it writes into the view, so a
 * remote change and a repair are told apart from the input of the person.
 * Neither schedules a save of this device and neither enters local undo.
 */
export function isRemoteChange(update: ViewUpdate): boolean {
  return update.transactions.some(
    (transaction) => transaction.annotation(ySyncAnnotation) !== undefined,
  );
}

/** One live document joined to one view. */
export type DocumentBinding = RemoteWorkGate & {
  /** The extensions that join the view to the document. */
  readonly extension: Extension;
};

/** Joins one session to one view and states how remote work reaches it. */
export function bindDocument(session: DocumentSession): DocumentBinding {
  const binding = editorBinding(session);
  const gate = remoteWorkGate(session);
  let composing = false;
  return {
    ...gate,
    extension: [
      yCollab(binding.text, null, { undoManager: binding.undoManager }),
      // Yjs holds the local undo of a bound editor, so the keys of the
      // shortcuts list run the undo manager rather than the CodeMirror
      // history that a plain editor keeps.
      keymap.of(yUndoManagerKeymap),
      EditorView.domEventHandlers({
        compositionstart: (): boolean => {
          composing = true;
          gate.compositionStarted();
          return false;
        },
        compositionend: (): boolean => {
          composing = false;
          gate.compositionEnded();
          return false;
        },
      }),
      // A composition can also end without the DOM event, for example when
      // the view loses focus, so every update reads the state of the view.
      EditorView.updateListener.of((update): void => {
        if (composing && !update.view.composing) {
          composing = false;
          gate.compositionEnded();
        }
      }),
    ],
  };
}
