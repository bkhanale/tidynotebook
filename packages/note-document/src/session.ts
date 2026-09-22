/**
 * The live document of one open note (record 0082).
 *
 * The editor needs a document that lives while the note is open, so a byte
 * API alone is not enough. A session is opaque: it hands out bytes and text,
 * and only the private editor bridge reaches the Yjs document inside it.
 *
 * Each session takes the default fresh client identity. Origins keep three
 * kinds of change apart: local input, remote work, and repair. A remote or a
 * repair change never counts as local input, so it never enters local undo
 * and never schedules another save.
 */
import * as Y from 'yjs';
import { documentBounds, type DocumentBounds } from './bounds.ts';
import {
  applyDocumentUpdate,
  loadDocument,
  noteTextRoot,
  type DocumentResult,
} from './document.ts';

/** Where one change of a session came from. */
export type SessionOrigin = 'local' | 'remote' | 'repair';

/** One change of a session, as the update that carries it. */
export type SessionChange = {
  readonly update: Uint8Array;
  readonly origin: SessionOrigin;
};

/** The transaction origin of remote work. */
const remoteOrigin = Symbol('notesapp remote work');

/** The transaction origin of a repair. */
const repairOrigin = Symbol('notesapp repair');

/** The documents of live sessions, which only the bridge reads. */
const liveDocuments = new WeakMap<DocumentSession, Y.Doc>();

/** The Yjs document of a live session, for the editor bridge only. */
export function liveDocumentOf(session: DocumentSession): Y.Doc {
  const doc = liveDocuments.get(session);
  if (doc === undefined) throw new Error('The document session has ended.');
  return doc;
}

/** The live document of one open note. */
export class DocumentSession {
  readonly #listeners = new Set<(change: SessionChange) => void>();
  readonly #bounds: DocumentBounds;
  readonly #onUpdate: (update: Uint8Array, origin: unknown) => void;
  #destroyers: (() => void)[] = [];

  constructor(document: Uint8Array, bounds: DocumentBounds) {
    const doc = loadDocument(document);
    this.#bounds = bounds;
    this.#onUpdate = (update, origin) => {
      const change: SessionChange = {
        update,
        origin:
          origin === remoteOrigin
            ? 'remote'
            : origin === repairOrigin
              ? 'repair'
              : 'local',
      };
      for (const listener of [...this.#listeners]) listener(change);
    };
    doc.on('update', this.#onUpdate);
    liveDocuments.set(this, doc);
  }

  /** The text that the session holds now. */
  text(): string {
    return liveDocumentOf(this).getText(noteTextRoot).toString();
  }

  /** The whole document as bytes. */
  encode(): Uint8Array {
    return Y.encodeStateAsUpdate(liveDocumentOf(this));
  }

  /** The complete observed state of the session. */
  observe(): Uint8Array {
    return Y.encodeSnapshot(Y.snapshot(liveDocumentOf(this)));
  }

  /** The state vector of the session, for a delta request. */
  stateVector(): Uint8Array {
    return Y.encodeStateVector(liveDocumentOf(this));
  }

  /** The work of the session that a peer with one state vector lacks. */
  encodeSince(stateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(liveDocumentOf(this), stateVector);
  }

  /** Applies accepted remote work, or refuses it with the session unchanged. */
  applyRemote(update: Uint8Array): DocumentResult<null> {
    return this.#applyForeign(update, remoteOrigin);
  }

  /** Applies a repair, or refuses it with the session unchanged. */
  applyRepair(update: Uint8Array): DocumentResult<null> {
    return this.#applyForeign(update, repairOrigin);
  }

  /** Listens for every change until the returned call. */
  subscribe(listener: (change: SessionChange) => void): () => void {
    liveDocumentOf(this);
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Runs one cleanup when the session ends, for the editor bridge. */
  onDestroy(destroy: () => void): void {
    liveDocumentOf(this);
    this.#destroyers.push(destroy);
  }

  /**
   * Ends the session. Listeners, the undo history of the bridge, and the
   * document are released, and every later call throws.
   */
  destroy(): void {
    const doc = liveDocuments.get(this);
    if (doc === undefined) return;
    for (const destroy of this.#destroyers) destroy();
    this.#destroyers = [];
    this.#listeners.clear();
    doc.off('update', this.#onUpdate);
    liveDocuments.delete(this);
    doc.destroy();
  }

  /**
   * Checks foreign work against a trial copy first. The live document takes
   * the update only when the trial accepts it, so refused work is never kept
   * as pending work that a later update could activate.
   */
  #applyForeign(update: Uint8Array, origin: symbol): DocumentResult<null> {
    const doc = liveDocumentOf(this);
    const trial = applyDocumentUpdate(
      Y.encodeStateAsUpdate(doc),
      update,
      this.#bounds,
    );
    if (!trial.ok) return trial;
    Y.applyUpdate(doc, update, origin);
    return { ok: true, value: null };
  }
}

/** Opens the live document of one note from its bytes. */
export function openDocumentSession(
  document: Uint8Array,
  bounds: DocumentBounds = documentBounds,
): DocumentSession {
  return new DocumentSession(document, bounds);
}
