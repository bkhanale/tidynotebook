/**
 * The document service of this deployment (records 0081, 0082).
 *
 * `packages/core` states the port and never implements it. This adapter maps
 * it to `packages/note-document`, which is the one package that loads Yjs, so
 * no Yjs type reaches the domain, the transport, or a screen. The server and
 * the migration command both build the service here, so one deployment has
 * one implementation.
 */
import {
  applyDocumentUpdate,
  documentStateVector,
  encodeDocumentDelta,
  observeDocument,
  observedCoverage,
  readDocumentText,
  replaceDocumentText,
  startDocument,
  type DocumentRefusal,
} from '@notesapp/note-document';
import {
  fail,
  ok,
  type AppliedDocument,
  type DocumentService,
  type DomainErrorCode,
  type Result,
} from '@notesapp/core';

/** The domain code of one refusal of the document package. */
function domainCode(refusal: DocumentRefusal): DomainErrorCode {
  if (refusal === 'malformed') return 'document_malformed';
  if (refusal === 'missing-dependency') return 'document_dependency_missing';
  if (refusal === 'unsupported-structure') return 'document_unsupported';
  // Text that is not well formed is content that the workspace cannot store,
  // so it answers with the content code that every other bad body answers.
  if (refusal === 'not-well-formed') return 'invalid_content';
  return 'document_too_large';
}

/** Builds the document service of this deployment. */
export function createDocumentService(): DocumentService {
  return {
    start: (text: string) => startDocument(text),
    apply: (
      document: Uint8Array,
      update: Uint8Array,
    ): Result<AppliedDocument> => {
      const applied = applyDocumentUpdate(document, update);
      if (!applied.ok) return fail(domainCode(applied.refusal));
      return ok({
        bytes: applied.value.document,
        text: applied.value.text,
        state: observeDocument(applied.value.document),
      });
    },
    replaceText: (
      document: Uint8Array,
      text: string,
    ): Result<AppliedDocument> => {
      const written = replaceDocumentText(document, text);
      if (!written.ok) return fail(domainCode(written.refusal));
      return ok({
        bytes: written.value.document,
        text: written.value.text,
        state: observeDocument(written.value.document),
      });
    },
    observe: (document: Uint8Array) => observeDocument(document),
    stateVector: (document: Uint8Array) => documentStateVector(document),
    delta: (document: Uint8Array, stateVector: Uint8Array) =>
      encodeDocumentDelta(document, stateVector),
    readText: (document: Uint8Array) => readDocumentText(document),
    covers: (observed: Uint8Array, document: Uint8Array): Result<boolean> => {
      // The epoch of both sides is the same by construction here: the caller
      // refuses a save of another generation before it asks.
      const coverage = observedCoverage(
        { epoch: 1, state: observed },
        { epoch: 1, document },
      );
      if (!coverage.ok) return fail(domainCode(coverage.refusal));
      return ok(coverage.value === 'covered');
    },
  };
}
