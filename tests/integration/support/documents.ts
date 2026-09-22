/**
 * The document work that a test sends, as a device builds it.
 *
 * A save carries work, not text (record 0081). A test that writes a note
 * therefore holds a document, folds its text into it, and sends the update
 * that follows the state the server already has. These helpers do exactly
 * that, so a test drives the same path as the application.
 */
import { getRevision } from '@notesapp/api-client';
import {
  documentStateVector,
  encodeDocumentDelta,
  observeDocument,
  replaceDocumentText,
  startDocument,
} from '@notesapp/note-document';

/** The base64 of one byte string, as the contract states it. */
export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** The bytes of one base64 value of the contract. */
export function bytesOf(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/** The document of one device, with the state the server has of it. */
export type TestDocument = {
  readonly bytes: Uint8Array;
  readonly appliedVector: Uint8Array;
};

/** An empty document, which is what a device holds before it writes. */
export function emptyDocument(): TestDocument {
  const bytes = startDocument('');
  return { bytes, appliedVector: documentStateVector(bytes) };
}

/** The document of a note that the server already holds, as base64. */
export function documentOf(value: string): TestDocument {
  const bytes = bytesOf(value);
  return { bytes, appliedVector: documentStateVector(bytes) };
}

/** One save of a text, and the document that the device then holds. */
export function saveOf(
  document: TestDocument,
  text: string,
): {
  readonly save: {
    readonly update: string;
    readonly epoch: number;
    readonly observed: string;
  };
  readonly document: TestDocument;
} {
  const written = replaceDocumentText(document.bytes, text);
  if (!written.ok)
    throw new Error(`the document refused the text: ${written.refusal}`);
  const next = written.value.document;
  return {
    save: {
      update: base64(encodeDocumentDelta(next, document.appliedVector)),
      epoch: 1,
      observed: base64(observeDocument(document.bytes)),
    },
    document: { bytes: next, appliedVector: documentStateVector(next) },
  };
}

/** The save of a first write of a note, which starts its document. */
export function firstSave(text: string): {
  readonly update: string;
  readonly epoch: number;
  readonly observed: string;
} {
  return saveOf(emptyDocument(), text).save;
}

/** The save that a deletion carries: what this device had seen, and no work. */
export function deletionOf(document: TestDocument): {
  readonly update: null;
  readonly epoch: number;
  readonly observed: string;
} {
  return {
    update: null,
    epoch: 1,
    observed: base64(observeDocument(document.bytes)),
  };
}

/**
 * The save that writes one text into a note that the server already holds.
 *
 * It reads the document of the head, folds the text into it, and states the
 * work that follows. This is the path of a device that has the note open.
 */
export async function saveForHead(
  workspaceId: string,
  revisionId: string,
  text: string,
): Promise<{
  readonly update: string;
  readonly epoch: number;
  readonly observed: string;
}> {
  const head = await getRevision({ path: { workspaceId, revisionId } });
  const document = head.data?.document ?? null;
  return saveOf(
    document === null ? emptyDocument() : documentOf(document),
    text,
  ).save;
}

/** The deletion save of a note that the server holds, from its head. */
export async function deletionForHead(
  workspaceId: string,
  revisionId: string,
): Promise<{
  readonly update: null;
  readonly epoch: number;
  readonly observed: string;
}> {
  const head = await getRevision({ path: { workspaceId, revisionId } });
  const document = head.data?.document ?? null;
  return deletionOf(document === null ? emptyDocument() : documentOf(document));
}
