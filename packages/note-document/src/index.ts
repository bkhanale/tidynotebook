/**
 * The byte API of a note document (record 0082).
 *
 * Every export takes and returns bytes or text, so no Yjs type reaches core,
 * sync, storage, or a web feature. The live editor reads the private
 * `./editor-bridge` entry, which only `packages/editor` may import.
 */
export type { DocumentBounds } from './bounds.ts';
export { documentBounds } from './bounds.ts';
export type {
  AppliedDocument,
  DocumentRefusal,
  DocumentResult,
} from './document.ts';
export {
  applyDocumentUpdate,
  compactDocument,
  documentStateVector,
  encodeDocumentDelta,
  mergeDocumentUpdates,
  noteTextRoot,
  readDocumentText,
  startDocument,
} from './document.ts';
export type { Coverage, DocumentInEpoch, ObservedInEpoch } from './observed.ts';
export { observeDocument, observedCoverage } from './observed.ts';
export type {
  DocumentSession,
  SessionChange,
  SessionOrigin,
} from './session.ts';
export { openDocumentSession } from './session.ts';
