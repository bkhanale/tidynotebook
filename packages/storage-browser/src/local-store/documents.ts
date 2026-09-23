/**
 * The document of each note on this device (records 0081, 0085).
 *
 * A save carries work, not text. This module holds the one place where the
 * text of a working copy becomes that work: the device folds its text into
 * its own document and sends the update that follows the state the server
 * already has. Two devices that write at the same time therefore keep both
 * edits, because each update names the characters it touches.
 *
 * Every write reads the stored document again inside the same transaction and
 * merges into it. A tab never replaces the row with a buffer that it read
 * earlier, so two tabs that write before either reads the other cannot lose
 * work.
 */
import {
  applyDocumentUpdate,
  documentStateVector,
  encodeDocumentDelta,
  mergeStateVectors,
  observeDocument,
  readDocumentText,
  replaceDocumentText,
  startDocument,
} from '@notesapp/note-document';
import type { DocumentSave } from '@notesapp/core';
import { LocalStorageError } from '@notesapp/sync';
import type { DocumentRow, Tables } from '../database.ts';
import { validateDocument } from '../migrations.ts';

/** The key of one document row. */
export type DocumentKey = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly fileId: string;
};

/** Reads the stored document of one note, or `null`. */
export async function readDocumentRow(
  tables: Tables,
  key: DocumentKey,
): Promise<DocumentRow | null> {
  const stored: unknown = await tables.documents.get([
    key.serverOrigin,
    key.accountId,
    key.workspaceId,
    key.fileId,
  ]);
  return stored === undefined ? null : validateDocument(stored);
}

/** The document that a note holds now, or a started one for a new note. */
function documentOrStart(row: DocumentRow | null, text: string): DocumentRow {
  if (row !== null) return row;
  const bytes = startDocument(text);
  return {
    serverOrigin: '',
    accountId: '',
    workspaceId: '',
    fileId: '',
    bytes,
    epoch: 1,
    // A note that this device starts has sent nothing yet, so the server has
    // none of its work and the first save carries the whole document.
    appliedVector: documentStateVector(startDocument('')),
  };
}

/**
 * Folds one text into the document of a note and states the save it makes.
 *
 * The text of the working copy is the text a person sees. Writing it into the
 * document keeps every character that stayed, so the update that follows
 * names only what changed and merges with the work of another device.
 */
export async function foldTextIntoDocument(
  tables: Tables,
  key: DocumentKey,
  text: string,
): Promise<{ readonly row: DocumentRow; readonly save: DocumentSave }> {
  const current = await readDocumentRow(tables, key);
  const base = documentOrStart(current, text);
  const written = replaceDocumentText(base.bytes, text);
  if (!written.ok)
    throw new LocalStorageError(
      'corrupt',
      `the document of this note refused the text: ${written.refusal}`,
    );
  const row: DocumentRow = {
    ...key,
    bytes: written.value.document,
    epoch: base.epoch,
    appliedVector: base.appliedVector,
  };
  return {
    row,
    save: {
      work: {
        kind: 'update',
        update: encodeDocumentDelta(row.bytes, base.appliedVector),
      },
      epoch: row.epoch,
      observed: observeDocument(row.bytes),
    },
  };
}

/**
 * The save that a deletion carries.
 *
 * A deletion states the complete state that this device had seen and no text
 * work at all. The workspace refuses it when that state does not cover the
 * text the note holds, so a deletion never hides an edit from another device
 * (record 0083).
 */
export async function deletionSave(
  tables: Tables,
  key: DocumentKey,
): Promise<DocumentSave> {
  const current = await readDocumentRow(tables, key);
  const bytes = current?.bytes ?? startDocument('');
  return {
    work: { kind: 'none' },
    epoch: current?.epoch ?? 1,
    observed: observeDocument(bytes),
  };
}

/** What the server sent for one note, as the feed states it. */
export type ServerDocumentWork =
  /** The work that follows the state this device already holds. */
  | { readonly kind: 'update'; readonly update: Uint8Array }
  /** The whole document, which a snapshot and a new generation both send. */
  | { readonly kind: 'document'; readonly document: Uint8Array };

/**
 * Applies accepted server work to the document of one note.
 *
 * The device advances the state it believes the server has only with work
 * that it applied, so a receipt alone never moves it (record 0085). The text
 * that this returns is what the note now reads.
 */
export async function applyServerWork(
  tables: Tables,
  key: DocumentKey,
  epoch: number,
  work: ServerDocumentWork,
): Promise<{ readonly row: DocumentRow; readonly text: string }> {
  const current = await readDocumentRow(tables, key);
  if (work.kind === 'document') {
    // A whole document replaces what this device holds.
    const row: DocumentRow = {
      ...key,
      bytes: work.document,
      epoch,
      appliedVector: documentStateVector(work.document),
    };
    return { row, text: readDocumentText(work.document) };
  }
  // Work of another generation cannot join what this device holds, because
  // identities of one generation say nothing about another. Such work, and
  // the work of a note that this device holds no document for, applies to an
  // empty document. The first work of a new note starts from nothing, so it
  // applies whole. Any other work lacks what it depends on and is refused, so
  // the caller reads a snapshot instead of keeping an empty note.
  const joined = current === null || current.epoch !== epoch ? null : current;
  const empty = startDocument('');
  const applied = applyDocumentUpdate(joined?.bytes ?? empty, work.update);
  if (!applied.ok)
    throw new LocalStorageError(
      'stale',
      `the accepted work does not fit this document: ${applied.refusal}`,
    );
  const row: DocumentRow = {
    ...key,
    bytes: applied.value.document,
    epoch,
    // Only the accepted work moves the state this device believes the server
    // has. The unsent work of this device stays unsent (record 0085).
    appliedVector: mergeStateVectors(
      joined?.appliedVector ?? documentStateVector(empty),
      documentStateVector(work.update),
    ),
  };
  return { row, text: applied.value.text };
}
