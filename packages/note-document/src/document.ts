/**
 * The byte operations of one note document.
 *
 * A note holds one Yjs document with one text root (record 0081). Every value
 * that leaves this module is a byte array or plain text, so no caller holds a
 * Yjs type (record 0082). Each operation loads a fresh document from bytes,
 * so a refused update can never change the bytes that the caller holds.
 *
 * `applyDocumentUpdate` is the one door for foreign work. A successful Yjs
 * apply is not proof of a valid update: Yjs keeps work whose dependencies
 * have not arrived and applies it later. The door therefore applies to a
 * trial document, then refuses any unresolved insertion or deletion, any
 * structure other than plain text, and any result past the bounds.
 */
import * as Y from 'yjs';
import { documentBounds, type DocumentBounds } from './bounds.ts';

/** The name of the one text root of a note document. */
export const noteTextRoot = 'text';

/** Why an update was refused. The document bytes are unchanged. */
export type DocumentRefusal =
  /** The bytes are not a Yjs update. */
  | 'malformed'
  /** The update or the result is past a bound. */
  | 'too-large'
  /** The update writes something other than the plain text root. */
  | 'unsupported-structure'
  /** The update names an insertion or deletion that the document lacks. */
  | 'missing-dependency';

/** The outcome of one operation that can refuse. */
export type DocumentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: DocumentRefusal };

/** A document after an accepted update, with the text it now holds. */
export type AppliedDocument = {
  readonly document: Uint8Array;
  readonly text: string;
};

/** Loads a document from bytes that this package produced. */
export function loadDocument(document: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  doc.getText(noteTextRoot);
  Y.applyUpdate(doc, document);
  return doc;
}

/** Encodes the whole state of a loaded document. */
function encodeDocument(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Starts a document that holds one text.
 *
 * Record 0084: the server starts every existing note once, and a device
 * starts only a note that it creates. The document takes a fresh client
 * identity, and no caller names one.
 */
export function startDocument(text: string): Uint8Array {
  const doc = new Y.Doc();
  if (text !== '') doc.getText(noteTextRoot).insert(0, text);
  const bytes = encodeDocument(doc);
  doc.destroy();
  return bytes;
}

/** The text that a document holds. */
export function readDocumentText(document: Uint8Array): string {
  const doc = loadDocument(document);
  const text = doc.getText(noteTextRoot).toString();
  doc.destroy();
  return text;
}

/** The state vector of a document, which names every insertion it holds. */
export function documentStateVector(document: Uint8Array): Uint8Array {
  return Y.encodeStateVectorFromUpdate(document);
}

/**
 * The work of a document that a peer with one state vector lacks.
 *
 * A state vector serves this delta and nothing else. It does not track
 * deletions, so it never decides whether work is unseen (record 0081).
 */
export function encodeDocumentDelta(
  document: Uint8Array,
  stateVector: Uint8Array,
): Uint8Array {
  return Y.diffUpdate(document, stateVector);
}

/** Merges several updates into one without loading a document. */
export function mergeDocumentUpdates(
  updates: readonly Uint8Array[],
): Uint8Array {
  return Y.mergeUpdates([...updates]);
}

/**
 * Reads the structure of one update, or the reason to refuse it.
 *
 * Only plain text belongs to a note: a string or a deletion inside the text
 * root. A map entry, a formatting mark, an embed, a nested type, or any other
 * value is refused, because no reader of the note can hold it.
 */
function checkStructure(
  update: Uint8Array,
  bounds: DocumentBounds,
): DocumentRefusal | null {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return 'malformed';
  }
  if (decoded.structs.length > bounds.maxUpdateStructs) return 'too-large';
  for (const struct of decoded.structs) {
    if (!(struct instanceof Y.Item)) continue;
    if (struct.parentSub !== null) return 'unsupported-structure';
    if (typeof struct.parent === 'string' && struct.parent !== noteTextRoot)
      return 'unsupported-structure';
    if (struct.parent !== null && typeof struct.parent !== 'string')
      return 'unsupported-structure';
    const content = struct.content;
    if (
      !(content instanceof Y.ContentString) &&
      !(content instanceof Y.ContentDeleted)
    )
      return 'unsupported-structure';
  }
  return null;
}

/** Whether a trial document holds work that waits for a dependency. */
function waitsForDependency(doc: Y.Doc): boolean {
  return doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
}

/** Whether a trial document gained a root other than the text root. */
function gainedAnotherRoot(doc: Y.Doc): boolean {
  for (const name of doc.share.keys()) if (name !== noteTextRoot) return true;
  return false;
}

/**
 * Applies one foreign update to a document, or refuses it.
 *
 * The update applies to a trial document. The caller's bytes never change,
 * so a refusal leaves the accepted state exactly as it was, and a later
 * valid update cannot activate refused work, because that work was never
 * stored.
 */
export function applyDocumentUpdate(
  document: Uint8Array,
  update: Uint8Array,
  bounds: DocumentBounds = documentBounds,
): DocumentResult<AppliedDocument> {
  if (update.byteLength > bounds.maxUpdateBytes)
    return { ok: false, refusal: 'too-large' };
  const structure = checkStructure(update, bounds);
  if (structure !== null) return { ok: false, refusal: structure };
  const doc = loadDocument(document);
  try {
    try {
      Y.applyUpdate(doc, update);
    } catch {
      return { ok: false, refusal: 'malformed' };
    }
    if (waitsForDependency(doc))
      return { ok: false, refusal: 'missing-dependency' };
    if (gainedAnotherRoot(doc))
      return { ok: false, refusal: 'unsupported-structure' };
    const next = encodeDocument(doc);
    if (next.byteLength > bounds.maxDocumentBytes)
      return { ok: false, refusal: 'too-large' };
    return {
      ok: true,
      value: { document: next, text: doc.getText(noteTextRoot).toString() },
    };
  } finally {
    doc.destroy();
  }
}

/**
 * Compacts a document or a run of stored updates into one document.
 *
 * Record 0084: compaction merges updates and lets Yjs collect the content of
 * deleted text, and it keeps every character identity and the epoch. An
 * offline update made against an older state therefore still applies. It is
 * never a new document started from the current text, so it cannot promise a
 * fixed size.
 */
export function compactDocument(updates: readonly Uint8Array[]): Uint8Array {
  const doc = new Y.Doc();
  doc.getText(noteTextRoot);
  for (const update of updates) Y.applyUpdate(doc, update);
  const compacted = encodeDocument(doc);
  doc.destroy();
  return compacted;
}
